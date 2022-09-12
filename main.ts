import moment from "moment";
import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
} from "obsidian";
import * as path from "path";

interface LinkedUniqueNoteSettings {
	dateFormat: string;
	headerFormat: string;
	// I'm too lazy to change this to a proper setting
	template: string;
}

const DEFAULT_SETTINGS: LinkedUniqueNoteSettings = {
	dateFormat: "YYYY-MM-DD \\at HHːmm",
	headerFormat:
		'<span style="display: block;text-align: left;">←{prev}</span> <span style="display: block;text-align: right;">{next}→</span>\n\n',
	template: "#zettelkasten \n\n",
};

export default class LinkedUniqueNote extends Plugin {
	settings: LinkedUniqueNoteSettings;

	async jumpToLast(folder: TFolder) {
		const last = folder.children
			.filter<TFile>((v): v is TFile => v instanceof TFile)
			.map((file) => {
				const t: [moment.Moment, TFile] = [
					moment(file.name, this.settings.dateFormat),
					file,
				];
				return t;
			})
			.filter((v) => v[0].isValid())
			.sort((a, b) => a[0].valueOf() - b[0].valueOf())
			.last();
		if (last) {
			await this.app.workspace.getLeaf().openFile(last[1]);
		}
	}

	async newUniqueNote(folder: TFolder) {
		const newName = moment().format(this.settings.dateFormat);
		const prev_ = folder.children
			.filter<TFile>((v): v is TFile => v instanceof TFile)
			.map((file) => {
				const t: [moment.Moment, TFile] = [
					moment(file.name, this.settings.dateFormat),
					file,
				];
				return t;
			})
			.filter((v) => v[0].isValid())
			.sort((a, b) => a[0].valueOf() - b[0].valueOf())
			.last();
		const prevHandle = prev_ === undefined ? undefined : prev_[1];
		const prevName = prevHandle?.name ?? newName;
		const nextName = newName;
		const adapter = this.app.vault.adapter;

		const newPath = path.join(folder.path, newName + ".md");
		if (await adapter.exists(newPath)) {
			new Notice(`File ${newPath} already exists`);
		}

		const header = this.settings.headerFormat
			.replace(
				new RegExp("\\{prev\\}", "gi"),
				`[[${prevName.replace(".md", "")}]]`
			)
			.replace(new RegExp("\\{next\\}", "gi"), `[[${nextName}]]`);
		const data = this.settings.template + header;
		const newFile = await this.app.vault.create(newPath, data);

		await this.app.workspace.getLeaf().openFile(newFile);

		// update previous note
		if (!prevHandle) return;
		const text = (await adapter.read(prevHandle.path)).replace(
			prevHandle.name.replace(".md", ""),
			newName
		);
		const stat = await adapter.stat(prevHandle.path);
		const writeOptions = {
			ctime: stat?.ctime,
			mtime: stat?.mtime,
		};

		await adapter.write(prevHandle.path, text, writeOptions);
	}

	async conformFolder(folder: TFolder) {
		const children = folder.children
			.filter<TFile>((v): v is TFile => v instanceof TFile)
			.map((file) => {
				const t: [moment.Moment, TFile] = [
					moment(file.name, this.settings.dateFormat),
					file,
				];
				return t;
			})
			.filter((v) => v[0].isValid())
			.sort((a, b) => a[0].valueOf() - b[0].valueOf());

		let prev = children[0];
		let nextIdx = 1;

		for (const child of children) {
			const next = children[nextIdx];

			const prevHandle = prev[1];
			const nextHandle = next[1];
			const prevName = prevHandle.name;
			const nextName = nextHandle.name;
			const adapter = this.app.vault.adapter;

			const header = this.settings.headerFormat
				.replace(
					new RegExp("\\{prev\\}", "gi"),
					`[[${prevName.replace(".md", "")}]]`
				)
				.replace(
					new RegExp("\\{next\\}", "gi"),
					`[[${nextName.replace(".md", "")}]]`
				);
			const data = this.settings.template + header;

			const childPath = child[1].path;
			// update previous note
			const text = (await adapter.read(childPath)).replace(
				/#zettelkasten(.|\n)*span>/,
				data
			);
			const stat = await adapter.stat(childPath);
			const writeOptions = {
				ctime: stat?.ctime,
				mtime: stat?.mtime,
			};

			await adapter.write(childPath, text, writeOptions);

			prev = child;
			nextIdx += 1;
			if (nextIdx >= children.length) {
				nextIdx = children.length - 1;
			}
		}
	}

	async onload() {
		await this.loadSettings();

		this.registerEvent(
			app.workspace.on("file-menu", (menu, file, source, leaf) => {
				if (file instanceof TFolder) {
					menu.addItem((item) => {
						item.setTitle("New unique note")
							// .setIcon(kanbanIcon)
							.onClick(() => this.newUniqueNote(file));
					});
					return;
				}

				if (file instanceof TFile) {
					const parent = file.parent;
					menu.addItem((item) => {
						item.setTitle("New unique note")
							// .setIcon(kanbanIcon)
							.onClick(() => this.newUniqueNote(parent));
					});
				}
			})
		);
		this.registerEvent(
			app.workspace.on("file-menu", (menu, file, source, leaf) => {
				if (file instanceof TFolder) {
					menu.addItem((item) => {
						item.setTitle("Jump to last unique note")
							// .setIcon(kanbanIcon)
							.onClick(() => this.jumpToLast(file));
					});
					return;
				}

				if (file instanceof TFile) {
					const parent = file.parent;
					menu.addItem((item) => {
						item.setTitle("Jump to last unique note")
							// .setIcon(kanbanIcon)
							.onClick(() => this.jumpToLast(parent));
					});
				}
			})
		);
		// Vestigial code for my own purposes
		// Enable if you know what you want, this links *all* files with a proper
		// name format chronologically
		// It is NOT idempotent at all
		// eslint-disable-next-line no-constant-condition
		if (false) {
			this.registerEvent(
				app.workspace.on("file-menu", (menu, file, source, leaf) => {
					if (file instanceof TFolder) {
						menu.addItem((item) => {
							item.setTitle(
								"Conform folder to linked unique note"
							).onClick(() => this.conformFolder(file));
						});
						return;
					}
				})
			);
		}

		this.addSettingTab(new LinkedUniqueSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class LinkedUniqueSettingTab extends PluginSettingTab {
	plugin: LinkedUniqueNote;

	constructor(app: App, plugin: LinkedUniqueNote) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Unique linked note - settings" });

		new Setting(containerEl)
			.setName("Date format")
			.setDesc("Date format used for ordering your notes")
			.addText((text) =>
				text
					.setPlaceholder("")
					.setValue(this.plugin.settings.dateFormat)
					.onChange(async (value) => {
						this.plugin.settings.dateFormat = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("Header format format")
			.setDesc("Header format used for ordering your notes")
			.addText((text) =>
				text
					.setPlaceholder("")
					.setValue(this.plugin.settings.headerFormat)
					.onChange(async (value) => {
						this.plugin.settings.headerFormat = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
