import AutoNoteMover from "main";
import {
  App,
  PluginSettingTab,
  Setting,
  ButtonComponent,
  Modal,
} from "obsidian";

import { FolderSuggest } from "suggests/file-suggest";
import { TagSuggest } from "suggests/tag-suggest";
import { arrayMove } from "utils/Utils";

// Excluded Folders Modal
class ExcludedFoldersModal extends Modal {
  private plugin: AutoNoteMover;
  private onSave: () => void;

  constructor(app: App, plugin: AutoNoteMover, onSave?: () => void) {
    super(app);
    this.plugin = plugin;
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Manage Excluded Folders" });

    const desc = contentEl.createEl("p", {
      cls: "setting-item-description",
    });
    desc.append(
      "Notes in these folders will not be moved. ",
      desc.createEl("strong", { text: "This takes precedence over all rules." })
    );

    const listContainer = contentEl.createDiv({
      cls: "anm-excluded-folders-list",
    });

    const renderList = () => {
      listContainer.empty();
      this.plugin.settings.excluded_folder.forEach((folder, index) => {
        const row = listContainer.createDiv({
          cls: "anm-excluded-folder-row",
        });

        const searchSetting = new Setting(row).addSearch((cb) => {
          new FolderSuggest(this.app, cb.inputEl);
          cb.setPlaceholder("Folder")
            .setValue(folder.folder)
            .onChange(async (newFolder) => {
              this.plugin.settings.excluded_folder[index].folder = newFolder;
              await this.plugin.saveSettings();
            });
        });
        searchSetting.infoEl.remove();
        searchSetting.settingEl.addClass("anm-flex-grow");

        new ButtonComponent(row)
          .setIcon("cross")
          .setTooltip("Remove")
          .onClick(async () => {
            this.plugin.settings.excluded_folder.splice(index, 1);
            await this.plugin.saveSettings();
            renderList();
          });
      });
    };

    renderList();

    const buttonContainer = contentEl.createDiv({
      cls: "anm-modal-buttons",
    });

    new ButtonComponent(buttonContainer)
      .setButtonText("Add folder")
      .setIcon("plus")
      .onClick(async () => {
        this.plugin.settings.excluded_folder.push({ folder: "" });
        await this.plugin.saveSettings();
        renderList();
      });

    new ButtonComponent(buttonContainer)
      .setButtonText("Save & Close")
      .setCta()
      .onClick(async () => {
        await this.plugin.saveSettings();
        this.onSave?.();
        this.close();
      });
  }
}

export type MatchMode = "ALL" | "ANY";

export type ConditionType = "tag" | "title" | "property" | "date" | "folder";

export type DateSource = "frontmatter" | "metadata";
export type MetadataField = "ctime" | "mtime";

export interface RuleCondition {
  type: ConditionType;
  /**
   * Raw user value.
   * - tag: tag string (regex respected if global toggle enabled)
   * - title: regex pattern string
   * - property: `key` or `key=pattern`
   * - date (frontmatter): key name containing the date value
   * - folder: folder path to restrict rule application
   */
  value: string;
  /**
   * Date-specific metadata
   */
  dateSource?: DateSource;
  metadataField?: MetadataField;
  /**
   * Folder-specific: include subfolders in matching
   */
  includeSubfolders?: boolean;
}

export interface FolderTagRule {
  folder: string;
  match: MatchMode;
  conditions: RuleCondition[];
  date_property?: string;
  collapsed?: boolean;
}

export interface ExcludedFolder {
  folder: string;
}

export interface AutoNoteMoverSettings {
  trigger_auto_manual: string;
  trigger_on_file_creation: boolean;
  use_regex_to_check_for_tags: boolean;
  statusBar_trigger_indicator: boolean;
  folder_tag_pattern: Array<FolderTagRule>;
  use_regex_to_check_for_excluded_folder: boolean;
  excluded_folder: Array<ExcludedFolder>;
  hide_notifications?: boolean;
  duplicate_file_action?: "skip" | "merge";
}

export const DEFAULT_SETTINGS: AutoNoteMoverSettings = {
  trigger_auto_manual: "Automatic",
  trigger_on_file_creation: false,
  use_regex_to_check_for_tags: false,
  statusBar_trigger_indicator: true,
  folder_tag_pattern: [
    {
      folder: "",
      match: "ALL",
      conditions: [],
      date_property: "",
      collapsed: false,
    },
  ],
  use_regex_to_check_for_excluded_folder: false,
  excluded_folder: [{ folder: "" }],
  hide_notifications: false,
  duplicate_file_action: "skip",
};

export class AutoNoteMoverSettingTab extends PluginSettingTab {
  plugin: AutoNoteMover;

  constructor(app: App, plugin: AutoNoteMover) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    this.containerEl.empty();
    this.add_auto_note_mover_setting();
  }

  add_auto_note_mover_setting(): void {
    const descEl = document.createDocumentFragment();

    new Setting(this.containerEl).setName("Auto note mover").setHeading();

    new Setting(this.containerEl).setDesc(
      "Auto note mover will automatically move the active notes to their respective folders according to the rules.",
    );

    /* new Setting(this.containerEl)
			.setName('Auto Note Mover')
			.setDesc('Enable or disable the Auto Note Mover.')
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.enable_auto_note_mover)
					.onChange(async (use_new_auto_note_mover) => {
						this.plugin.settings.enable_auto_note_mover = use_new_auto_note_mover;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		if (!this.plugin.settings.enable_auto_note_mover) {
			return;
		} */

    const triggerDesc = document.createDocumentFragment();
    triggerDesc.append(
      "Choose how the trigger will be activated.",
      descEl.createEl("br"),
      descEl.createEl("strong", { text: "Automatic " }),
      "is triggered when you create, edit, or rename a note, and moves the note if it matches the rules.",
      descEl.createEl("br"),
      "You can also activate the trigger with a command.",
      descEl.createEl("br"),
      descEl.createEl("strong", { text: "Manual " }),
      "will not automatically move notes.",
      descEl.createEl("br"),
      "You can trigger by command.",
    );
    new Setting(this.containerEl)
      .setName("Trigger")
      .setDesc(triggerDesc)
      .addDropdown((dropDown) =>
        dropDown
          .addOption("Automatic", "Automatic")
          .addOption("Manual", "Manual")
          .setValue(this.plugin.settings.trigger_auto_manual)
          .onChange((value: string) => {
            this.plugin.settings.trigger_auto_manual = value;
            void this.plugin.saveData(this.plugin.settings);
            this.display();
          }),
      );

    const triggerOnFileCreationDesc = document.createDocumentFragment();
    triggerOnFileCreationDesc.append(
      "If disabled, notes will not be moved when created.",
      descEl.createEl("br"),
      "Only rename and metadata changes will trigger the move.",
    );
    new Setting(this.containerEl)
      .setName("Trigger on file creation")
      .setDesc(triggerOnFileCreationDesc)
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.trigger_on_file_creation)
          .onChange(async (value) => {
            this.plugin.settings.trigger_on_file_creation = value;
            await this.plugin.saveSettings();
          });
      });

    const duplicateFileActionDesc = document.createDocumentFragment();
    duplicateFileActionDesc.append(
      "What to do when a file with the same name exists in the destination folder.",
      descEl.createEl("br"),
      descEl.createEl("strong", { text: "Skip " }),
      "- Show error and do not move the file.",
      descEl.createEl("br"),
      descEl.createEl("strong", { text: "Merge " }),
      "- Open Note Composer merge dialog (Manual mode only).",
    );
    new Setting(this.containerEl)
      .setName("Duplicate file action")
      .setDesc(duplicateFileActionDesc)
      .addDropdown((dropdown) => {
        dropdown
          .addOption("skip", "Skip (show error)")
          .addOption("merge", "Merge with note composer")
          .setValue(this.plugin.settings.duplicate_file_action || "skip")
          .onChange(async (value) => {
            this.plugin.settings.duplicate_file_action = value as
              | "skip"
              | "merge";
            await this.plugin.saveSettings();
          });
      });

    const hideNotificationsDesc = document.createDocumentFragment();
    hideNotificationsDesc.append(
      "Hide success notifications when notes are moved.",
    );
    new Setting(this.containerEl)
      .setName("Hide notifications")
      .setDesc(hideNotificationsDesc)
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.hide_notifications || false)
          .onChange(async (value) => {
            this.plugin.settings.hide_notifications = value;
            await this.plugin.saveSettings();
          });
      });

    const useRegexToCheckForTags = document.createDocumentFragment();
    useRegexToCheckForTags.append(
      "If enabled, tags will be checked with regular expressions.",
      descEl.createEl("br"),
      "For example, if you want to match the #tag, you would write ",
      descEl.createEl("strong", { text: "^#tag$" }),
      descEl.createEl("br"),
      "This setting is for a specific purpose, such as specifying nested tags in bulk.",
      descEl.createEl("br"),
      descEl.createEl("strong", {
        text: "If you want to use the suggested tags as they are, it is recommended to disable this setting.",
      }),
    );
    new Setting(this.containerEl)
      .setName("Use regular expressions to check for tags")
      .setDesc(useRegexToCheckForTags)
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.use_regex_to_check_for_tags)
          .onChange(async (value) => {
            this.plugin.settings.use_regex_to_check_for_tags = value;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    const ruleDesc = document.createDocumentFragment();
    ruleDesc.append(
      "1) Destination folder: supports moment.js tokens like ",
      descEl.createEl("strong", { text: "{{YYYY}}/{{MM}}" }),
      ".",
      descEl.createEl("br"),
      "2) Add one or more conditions (tag / title regex / property / date). Combine them with ",
      descEl.createEl("strong", { text: "Match if all / any" }),
      ".",
      descEl.createEl("br"),
      "3) Rules are processed top-to-bottom. First match wins.",
      descEl.createEl("br"),
      descEl.createEl("br"),
      "- Tag: include the leading # (regex honored if enabled above).",
      descEl.createEl("br"),
      /* eslint-disable obsidianmd/ui/sentence-case */
      "- Title: JavaScript regex, e.g., ",
      descEl.createEl("code", { text: "draft$" }),
      ".",
      descEl.createEl("br"),
      "- Property: single field. Use ",
      descEl.createEl("code", { text: "key" }),
      " to require existence, or ",
      descEl.createEl("code", { text: "key=pattern" }),
      " to match a value/regex.",
      descEl.createEl("br"),
      "- Date: choose source (frontmatter key or file metadata ctime/mtime). Frontmatter keys must parse as dates; metadata uses the file timestamps. When folder path has {{tokens}}, that date is formatted with moment.js.",
      descEl.createEl("br"),
      "If the date is missing or cannot be parsed, the folder path is used as literal text (tokens stay as {{...}}).",
      descEl.createEl("br"),
      "- Folder: restrict rule to notes in a specific source folder.",
      descEl.createEl("br"),
      'Use "Include subfolders" to also match notes in subfolders, or "Exclude subfolders" to match only the exact folder.',
      descEl.createEl("br"),
      descEl.createEl("br"),
      'Notice: attachments stay put; frontmatter "',
      descEl.createEl("code", { text: "AutoNoteMover: disable" }),
      '" skips movement.',
      /* eslint-enable obsidianmd/ui/sentence-case */
    );
    new Setting(this.containerEl)
      .setName("Add new rule")
      .setDesc(ruleDesc)
      .addButton((button: ButtonComponent) => {
        button
          .setTooltip("Add new rule")
          .setButtonText("+")
          .setCta()
          .onClick(async () => {
            this.plugin.settings.folder_tag_pattern.push({
              folder: "",
              match: "ALL",
              conditions: [],
              date_property: "",
              collapsed: false,
            });
            await this.plugin.saveSettings();
            this.display();
          });
      });

    this.plugin.settings.folder_tag_pattern.forEach((rule, index) => {
      // Ensure at least one condition exists if empty
      if (rule.conditions.length === 0) {
        rule.conditions.push({ type: "tag", value: "" });
      }

      const renderConditionsList = (listEl: HTMLElement) => {
        listEl.empty();
        rule.conditions.forEach((cond, condIndex) => {
          const row = listEl.createDiv({ cls: "anm-condition-row" });

          // Type Select
          const typeSelect = row.createEl("select");
          ["tag", "title", "property", "date", "folder"].forEach((opt) => {
            const o = typeSelect.createEl("option");
            o.value = opt;
            o.text = opt.charAt(0).toUpperCase() + opt.slice(1);
            o.selected = cond.type === opt;
          });

          // Date source controls (created once, toggled per type)
          const dateSourceWrap = row.createDiv({ cls: "anm-date-source-wrap" });
          const dateSourceSelect = dateSourceWrap.createEl("select");
          ["frontmatter", "metadata"].forEach((opt) => {
            const o = dateSourceSelect.createEl("option");
            o.value = opt;
            o.text = opt === "frontmatter" ? "Frontmatter" : "Metadata";
            o.selected = (cond.dateSource || "frontmatter") === opt;
          });

          const metadataSelect = dateSourceWrap.createEl("select");
          metadataSelect.addClass("anm-metadata-select");
          ["ctime", "mtime"].forEach((opt) => {
            const o = metadataSelect.createEl("option");
            o.value = opt;
            o.text = opt === "ctime" ? "Created time" : "Modified time";
            o.selected = (cond.metadataField || "ctime") === opt;
          });

          // Folder-specific: subfolder mode select
          const folderOptionsWrap = row.createDiv({
            cls: "anm-folder-options-wrap",
          });
          const subfolderSelect = folderOptionsWrap.createEl("select");
          ["include", "exclude"].forEach((opt) => {
            const o = subfolderSelect.createEl("option");
            o.value = opt;
            o.text =
              opt === "include" ? "Include subfolders" : "Exclude subfolders";
            o.selected =
              (cond.includeSubfolders ? "include" : "exclude") === opt;
          });

          subfolderSelect.onchange = async () => {
            cond.includeSubfolders = subfolderSelect.value === "include";
            await this.plugin.saveSettings();
          };

          // Value Input
          const input = row.createEl("input");
          input.type = "text";
          input.value = cond.value;
          if (cond.type === "tag") {
            new TagSuggest(this.app, input);
          } else if (cond.type === "folder") {
            new FolderSuggest(this.app, input);
          }

          const updateInputState = () => {
            const source = cond.dateSource || "frontmatter";
            if (cond.type === "date") {
              input.placeholder = "Frontmatter key (e.g., date)";
              dateSourceWrap.removeClass("anm-hidden");
              dateSourceWrap.addClass("anm-visible");
              const metaMode = source === "metadata";
              dateSourceWrap.toggleClass("anm-flex-grow", metaMode);
              input.toggleClass("anm-hidden", metaMode);
              metadataSelect.toggleClass("anm-hidden", !metaMode);
              metadataSelect.toggleAttribute("disabled", !metaMode);
              folderOptionsWrap.addClass("anm-hidden");
            } else if (cond.type === "folder") {
              input.placeholder = "Source folder path";
              input.removeClass("anm-hidden");
              input.removeAttribute("disabled");
              dateSourceWrap.removeClass("anm-visible");
              dateSourceWrap.addClass("anm-hidden");
              metadataSelect.addClass("anm-hidden");
              folderOptionsWrap.removeClass("anm-hidden");
            } else {
              input.placeholder = "Tag / regex / key=pattern";
              input.removeClass("anm-hidden");
              input.removeAttribute("disabled");
              dateSourceWrap.removeClass("anm-visible");
              dateSourceWrap.addClass("anm-hidden");
              metadataSelect.addClass("anm-hidden");
              folderOptionsWrap.addClass("anm-hidden");
            }
          };

          const persistDateDefaults = () => {
            if (cond.type === "date") {
              cond.dateSource = cond.dateSource || "frontmatter";
              if (cond.dateSource === "metadata") {
                cond.metadataField = cond.metadataField || "ctime";
              } else {
                delete cond.metadataField;
              }
            }
          };

          typeSelect.onchange = async () => {
            cond.type = typeSelect.value as ConditionType;
            persistDateDefaults();
            updateInputState();
            await this.plugin.saveSettings();
          };

          dateSourceSelect.onchange = async () => {
            cond.dateSource = dateSourceSelect.value as DateSource;
            if (cond.dateSource === "metadata") {
              cond.value = "";
              input.value = "";
            }
            updateInputState();
            await this.plugin.saveSettings();
          };

          metadataSelect.onchange = async () => {
            cond.metadataField = metadataSelect.value as MetadataField;
            await this.plugin.saveSettings();
          };

          input.onchange = async () => {
            cond.value = input.value;
            await this.plugin.saveSettings();
          };

          persistDateDefaults();
          updateInputState();

          // Delete Button
          new ButtonComponent(row)
            .setIcon("cross")
            .setTooltip("Delete condition")
            .onClick(async () => {
              rule.conditions.splice(condIndex, 1);
              if (rule.conditions.length === 0) {
                rule.conditions.push({ type: "tag", value: "" });
              }
              await this.plugin.saveSettings();
              renderConditionsList(listEl);
            });
        });
      };

      // Create Card Container
      const card = this.containerEl.createDiv({ cls: "anm-rule-card" });

      // --- Header: Folder, Date, Match Mode, Actions ---
      const header = card.createDiv({ cls: "anm-card-header" });
      const headerMain = header.createDiv({ cls: "anm-card-header-main" });
      const actions = header.createDiv({ cls: "anm-card-actions" });
      // Collapse toggle (left top)
      const toggleBtn = new ButtonComponent(
        headerMain.createDiv({ cls: "anm-collapse-btn" }),
      )
        .setIcon(rule.collapsed ? "chevron-right" : "chevron-down")
        .setTooltip("Collapse/expand");

      toggleBtn.onClick(async () => {
        rule.collapsed = !rule.collapsed;
        await this.plugin.saveSettings();
        body.toggleClass("anm-collapsed", rule.collapsed);
        toggleBtn.setIcon(rule.collapsed ? "chevron-right" : "chevron-down");
      });

      // Folder Input
      const folderSetting = new Setting(headerMain).addSearch((cb) => {
        new FolderSuggest(this.app, cb.inputEl);
        cb.setPlaceholder("Folder")
          .setValue(rule.folder)
          .onChange(async (newFolder) => {
            this.plugin.settings.folder_tag_pattern[index].folder =
              newFolder.trim();
            await this.plugin.saveSettings();
          });
      });
      folderSetting.settingEl.addClass("anm-flex-grow");
      folderSetting.settingEl.addClass("anm-folder-setting");
      folderSetting.infoEl.remove();

      // Match Mode
      const matchSetting = new Setting(headerMain).addDropdown((drop) => {
        drop
          .addOption("ALL", "Match if all")
          .addOption("ANY", "Match if any")
          .setValue(rule.match || "ALL")
          .onChange(async (val: string) => {
            this.plugin.settings.folder_tag_pattern[index].match =
              val === "ANY" ? "ANY" : "ALL";
            await this.plugin.saveSettings();
          });
      });
      matchSetting.infoEl.remove();

      // Actions (Up, Down, Delete)
      new ButtonComponent(actions)
        .setIcon("up-chevron-glyph")
        .setTooltip("Move up")
        .onClick(async () => {
          arrayMove(this.plugin.settings.folder_tag_pattern, index, index - 1);
          await this.plugin.saveSettings();
          this.display();
        });
      new ButtonComponent(actions)
        .setIcon("down-chevron-glyph")
        .setTooltip("Move down")
        .onClick(async () => {
          arrayMove(this.plugin.settings.folder_tag_pattern, index, index + 1);
          await this.plugin.saveSettings();
          this.display();
        });
      new ButtonComponent(actions)
        .setIcon("cross")
        .setTooltip("Delete")
        .onClick(async () => {
          this.plugin.settings.folder_tag_pattern.splice(index, 1);
          await this.plugin.saveSettings();
          this.display();
        });

      // --- Body (collapsible) ---
      const body = card.createDiv({ cls: "anm-card-body" });
      if (rule.collapsed) {
        body.addClass("anm-collapsed");
      }

      // --- Divider ---
      body.createDiv({ cls: "anm-card-divider" });

      // --- Conditions List ---
      const conditionsList = body.createDiv({ cls: "anm-card-conditions" });
      renderConditionsList(conditionsList);

      const addBtnContainer = body.createDiv({ cls: "anm-add-btn-container" });
      new ButtonComponent(addBtnContainer)
        .setButtonText("+ add")
        .onClick(async () => {
          rule.conditions.push({ type: "tag", value: "" });
          await this.plugin.saveSettings();
          renderConditionsList(conditionsList);
        });
    });

    const useRegexToCheckForExcludedFolder = document.createDocumentFragment();
    useRegexToCheckForExcludedFolder.append(
      "If enabled, excluded folder will be checked with regular expressions.",
    );

    new Setting(this.containerEl)
      .setName("Use regular expressions to check for excluded folder")
      .setDesc(useRegexToCheckForExcludedFolder)
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.use_regex_to_check_for_excluded_folder)
          .onChange(async (value) => {
            this.plugin.settings.use_regex_to_check_for_excluded_folder = value;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    const excludedFolderDesc = document.createDocumentFragment();
    excludedFolderDesc.append(
      "Notes in these folders will not be moved. ",
      descEl.createEl("strong", { text: "This takes precedence over all rules." })
    );

    const excludedSetting = new Setting(this.containerEl)
      .setName("Excluded folders")
      .setDesc(excludedFolderDesc)
      .addButton((button: ButtonComponent) => {
        button
          .setButtonText("Manage")
          .onClick(() => {
            new ExcludedFoldersModal(this.app, this.plugin, () => {
              renderExcludedFolders();
            }).open();
          });
      });

    const excludedListContainer = excludedSetting.infoEl.createDiv({
      cls: "anm-excluded-folders-inline",
    });

    const renderExcludedFolders = () => {
      excludedListContainer.empty();
      const folders = this.plugin.settings.excluded_folder
        .filter((f) => f.folder)
        .map((f) => f.folder);

      if (folders.length > 0) {
        const tagsContainer = excludedListContainer.createDiv({
          cls: "anm-tags-container",
        });

        folders.forEach((folder) => {
          const tag = tagsContainer.createEl("span", {
            cls: "anm-folder-tag",
          });
          tag.appendText(folder);
        });

        const countInfo = excludedListContainer.createEl("span", {
          cls: "anm-excluded-count",
        });
        countInfo.appendText(
          `${folders.length} folder${folders.length > 1 ? "s" : ""} excluded`
        );
      } else {
        const emptyMsg = excludedListContainer.createEl("span", {
          cls: "anm-empty-message",
        });
        emptyMsg.appendText("No folders excluded");
      }
    };

    renderExcludedFolders();

    const statusBarTriggerIndicatorDesc = document.createDocumentFragment();
    statusBarTriggerIndicatorDesc.append(
      "The status bar will display [A] if the trigger is Automatic, and [M] for Manual.",
      descEl.createEl("br"),
      "To change the setting, you need to restart Obsidian.",
      descEl.createEl("br"),
      "Desktop only.",
    );
    new Setting(this.containerEl)
      .setName("Status bar trigger indicator")
      .setDesc(statusBarTriggerIndicatorDesc)
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.statusBar_trigger_indicator)
          .onChange(async (value) => {
            this.plugin.settings.statusBar_trigger_indicator = value;
            await this.plugin.saveSettings();
            this.display();
          });
      });
  }
}
