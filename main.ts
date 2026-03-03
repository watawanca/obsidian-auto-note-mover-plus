import {MarkdownView, Plugin, TFile, TFolder, TAbstractFile, getAllTags, Notice, normalizePath} from 'obsidian';
import { DEFAULT_SETTINGS, AutoNoteMoverSettings, AutoNoteMoverSettingTab, FolderTagRule, RuleCondition } from 'settings/settings';
import { fileMove, getTriggerIndicator, isFmDisable } from 'utils/Utils';
import { isRuleMatched } from 'utils/ruleMatching';
import { processFolderPath } from 'utils/pathProcessing';

export default class AutoNoteMover extends Plugin {
	settings: AutoNoteMoverSettings;
	private recentlyCreatedFiles: Set<string> = new Set();

	onload(): void {
		void this.initialize();
	}

	async initialize(): Promise<void> {
		await this.loadSettings();

		const fileCheck = async (
			file: TAbstractFile,
			oldPath?: string,
			caller?: string
		): Promise<boolean> => {
			const folderTagPattern = this.settings.folder_tag_pattern;
			const excludedFolder = this.settings.excluded_folder;

			if (this.settings.trigger_auto_manual !== 'Automatic' && caller !== 'cmd') {
				return false;
			}
			if (!(file instanceof TFile)) return false;

			// Prevent rename loop when basename unchanged
			if (oldPath && oldPath.split('/').pop() === file.basename + '.' + file.extension) {
				return false;
			}

			// Excluded folder check
			for (const excluded of excludedFolder) {
				if (!excluded.folder) continue;

				if (!this.settings.use_regex_to_check_for_excluded_folder) {
					if (file.parent.path === normalizePath(excluded.folder)) {
						return false;
					}
				} else {
					try {
						const regex = new RegExp(excluded.folder);
						if (regex.test(file.parent.path)) return false;
					} catch {
						if (file.parent.path.includes(excluded.folder)) return false;
					}
				}
			}

			const fileCache = this.app.metadataCache.getFileCache(file);
			if (!fileCache) return false;
			if (isFmDisable(fileCache)) return false;

			const fileName = file.basename;
			const fileFullName = file.basename + '.' + file.extension;
			const cacheTag = getAllTags(fileCache) || [];

			for (const rule of folderTagPattern) {
				const result = isRuleMatched(rule, {
					fileCache,
					fileName,
					tags: cacheTag,
					useRegexForTags: this.settings.use_regex_to_check_for_tags,
					file,
				});

				if (!result.matched) continue;

				const processedFolder = processFolderPath(
					rule.folder,
					fileCache,
					file,
					rule,
					result.captureGroups
				);

				let finalFolder = processedFolder;

				// ---- Topic-based subfolder selection ----
				const topicRaw = fileCache?.frontmatter?.Topic;
				const topicNum = Number(topicRaw);

				if (!isNaN(topicNum) && topicNum > 0) {
					const topicPrefix = String(topicNum).padStart(2, '0');

					const baseFolder = this.app.vault.getAbstractFileByPath(processedFolder);

					if (baseFolder instanceof TFolder) {
						const matchedSubfolder = baseFolder.children.find(
							(child) =>
								child instanceof TFolder &&
								child.name.startsWith(`Topic ${topicPrefix} -`)
						);

						if (matchedSubfolder instanceof TFolder) {
							finalFolder = matchedSubfolder.path;
						}
					}
				}

				// Prevent unnecessary folder-only move loop
				if (file.parent.path === finalFolder) {
					return false;
				}

				const originalPath = file.path;

				await fileMove(
					this.app,
					finalFolder,
					fileFullName,
					file,
					this.settings.hide_notifications,
					this.settings.duplicate_file_action,
					caller
				);

				return file.path !== originalPath;
			}

			return false;
		};

		// Show trigger indicator on status bar
		let triggerIndicator: HTMLElement;
		const setIndicator = () => {
			if (!this.settings.statusBar_trigger_indicator) return;
			triggerIndicator.setText(getTriggerIndicator(this.settings.trigger_auto_manual));
		};
		if (this.settings.statusBar_trigger_indicator) {
			triggerIndicator = this.addStatusBarItem();
			setIndicator();
			// TODO: Is there a better way?
			this.registerDomEvent(window, 'change', setIndicator);
		}

		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on('create', (file) => {
				if (!(file instanceof TFile)) return;
				this.recentlyCreatedFiles.add(file.path);
				setTimeout(() => {
					this.recentlyCreatedFiles.delete(file.path);
				}, 5000);
				if (this.settings.trigger_on_file_creation) {
					void fileCheck(file);
				}
			}));
			this.registerEvent(this.app.metadataCache.on('changed', (file) => {
				if (!this.settings.trigger_on_file_creation && this.recentlyCreatedFiles.has(file.path)) {
					return;
				}
				void fileCheck(file);
			}));
			this.registerEvent(this.app.vault.on('rename', (file, oldPath) => void fileCheck(file, oldPath)));
		});

		const moveNoteCommand = (view: MarkdownView) => {
			if (isFmDisable(this.app.metadataCache.getFileCache(view.file))) {
				new Notice('Auto note mover is disabled in the frontmatter.');
				return;
			}
			void fileCheck(view.file, undefined, 'cmd');
		};

		this.addCommand({
			id: 'Move-the-note',
			name: 'Move note',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						moveNoteCommand(markdownView);
					}
					return true;
				}
			},
		});

		this.addCommand({
			id: 'Move-all-notes',
			name: 'Move all notes matching rules',
			callback: async () => {
				const files = this.app.vault.getMarkdownFiles();
				let moved = 0;
				let processed = 0;
				const total = files.length;

				const progressNotice = new Notice(`Processing: 0/${total}`, 0);

				for (const file of files) {
					const wasMoved = await fileCheck(file, undefined, 'cmd');
					if (wasMoved) moved++;
					processed++;
					progressNotice.setMessage(`Processing: ${processed}/${total}`);
				}

				progressNotice.hide();
				new Notice(`Moved ${moved} notes (${total - moved} skipped)`);
			},
		});

		this.addCommand({
			id: 'Toggle-Auto-Manual',
			name: 'Toggle trigger',
			callback: () => {
				if (this.settings.trigger_auto_manual === 'Automatic') {
					this.settings.trigger_auto_manual = 'Manual';
					void this.saveData(this.settings);
					new Notice('Auto note mover: trigger is manual.');
				} else if (this.settings.trigger_auto_manual === 'Manual') {
					this.settings.trigger_auto_manual = 'Automatic';
					void this.saveData(this.settings);
					new Notice('Auto note mover: trigger is automatic.');
				}
				setIndicator();
			},
		});

		this.addSettingTab(new AutoNoteMoverSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<AutoNoteMoverSettings> | null;
		const merged: AutoNoteMoverSettings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		if (merged.folder_tag_pattern) {
			merged.folder_tag_pattern = merged.folder_tag_pattern.map((rule: FolderTagRule) => {
				// Already in new shape
				if (rule.conditions) {
					const normalizedConds = rule.conditions || [];
					const hasDateCond = normalizedConds.some((c: RuleCondition) => c?.type === 'date');
					if (!hasDateCond && rule.date_property) {
						normalizedConds.push({ type: 'date', value: rule.date_property, dateSource: 'frontmatter', metadataField: 'ctime' });
					}
					return {
						folder: rule.folder || '',
						match: rule.match === 'ANY' ? 'ANY' : 'ALL',
						conditions: normalizedConds,
						date_property: rule.date_property || '',
					};
				}

				// Migrate legacy fields
				const conditions: RuleCondition[] = [];
				const legacyRule = rule as FolderTagRule & { tag?: string; pattern?: string; property?: string; property_value?: string };
				if (legacyRule.tag) conditions.push({ type: 'tag', value: legacyRule.tag });
				if (legacyRule.pattern) conditions.push({ type: 'title', value: legacyRule.pattern });
				if (legacyRule.property || legacyRule.property_value) {
					const pv = legacyRule.property_value ? `${legacyRule.property}=${legacyRule.property_value}` : legacyRule.property;
					if (pv) conditions.push({ type: 'property', value: pv });
				}
				if (rule.date_property) {
					conditions.push({ type: 'date', value: rule.date_property, dateSource: 'frontmatter', metadataField: 'ctime' });
				}

				return {
					folder: rule.folder || '',
					match: 'ALL' as const,
					conditions,
					date_property: rule.date_property || '',
					sourceFolders: [] as string[],
					sourceIncludeSubfolders: false,
				};
			});
		}

		this.settings = merged;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
