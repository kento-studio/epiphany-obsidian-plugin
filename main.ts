import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  RequestUrlParam,
  Setting,
  WorkspaceLeaf,
  request,
} from 'obsidian';
import { EmailView, VIEW_TYPE_EMAIL } from './email-view';
import { OTPView, VIEW_TYPE_OTP } from './otp-view';

interface EpiphanySettings {
  baseUrl: string;
  jwtToken: string | null;
  createSeparateNotes: boolean;
}

const DEFAULT_SETTINGS: EpiphanySettings = {
  baseUrl: 'https://api-v2.epiphanyvoice.app',
  jwtToken: null,
  createSeparateNotes: false,
};

type Upload = {
  id: string;
  userId: string;
  label?: string;
  url: string;
  transcription: string;
  createdAt?: Date;
};

export default class EpiphanyPlugin extends Plugin {
  settings: EpiphanySettings;
  private authRequestId: string | null = null;
  private isLoginOpen = false;

  async openEmailView() {
    this.isLoginOpen = true;
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: VIEW_TYPE_EMAIL,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  async openOTPView() {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: VIEW_TYPE_OTP,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  async handleEmailSubmit(email: string) {
    const url = `${this.settings.baseUrl}/api/auth/login`;
    const options: RequestUrlParam = {
      url: url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    };

    try {
      const response = await request(options);
      const res = JSON.parse(response);

      if (res.error) {
        throw new Error(res.message);
      }
      this.authRequestId = res.auth_request_id;
      new Notice('OTP sent to your email.');
      this.openOTPView();
      this.app.workspace.detachLeavesOfType(VIEW_TYPE_EMAIL);
    } catch (err) {
      new Notice(err.message || 'Unknown error');
    }
  }

  async handleOTPSubmit(otp: string) {
    if (!this.authRequestId) {
      new Notice('No auth request ID found. Please start the process again.');
      return;
    }

    const url = `${this.settings.baseUrl}/api/auth/verify-code`;
    const options: RequestUrlParam = {
      url: url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ auth_request_id: this.authRequestId, code: otp }),
    };

    try {
      const response = await request(options);
      const res = JSON.parse(response);

      if (res.error) {
        throw new Error(res.message);
      }

      this.settings.jwtToken = res.jwt_token;
      await this.saveSettings();

      this.app.workspace.detachLeavesOfType(VIEW_TYPE_OTP);
      this.isLoginOpen = false;
      new Notice('Login successful!');
    } catch (err) {
      new Notice(err.message || 'Unknown error');
    }
  }

  async fetchNotes() {
    const url = `${this.settings.baseUrl}/api/uploads/obsidian`;
    const options: RequestUrlParam = {
      url: url,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
		'Authorization': `Bearer ${this.settings.jwtToken}`,
        'ngrok-skip-browser-warning': '69420',
      },
    };

    try {
      const response = await request(options);
      const res = JSON.parse(response);

      if (res.error) {
        throw new Error(res.message);
      }
      if (res.length !== 0) {
        if (this.settings.createSeparateNotes) {
          res.forEach(async (upload: Upload) => {
            await this.app.vault.create(
              `${upload.label}.md`,
              `${upload.transcription} \n [audio](${upload.url})`
            );
            await this.updateNote(upload.id);
          });
        } else {
          this.modifyFile(res);
        }
      } else {
        return;
      }
    } catch (err) {
      new Notice(err.message || 'Unknown error');
    }
  }

  async modifyFile(res: Upload[]) {
    const combinedFilePath = 'Epiphany Notes.md';
    let combinedFile = await this.app.vault.getFileByPath(combinedFilePath);

    if (!combinedFile) {
      combinedFile = await this.app.vault.create(combinedFilePath, '');
    }

    let combinedContent = await this.app.vault.read(combinedFile);

    // Append each note to the combined content
    res.forEach(async (upload) => {
      const noteContent = `## ${upload.label} \n ${upload.transcription} \n [audio](${upload.url})\n\n`;
      combinedContent += noteContent;
      await this.updateNote(upload.id);
    });

    await this.app.vault.modify(combinedFile, combinedContent);
  }

  async updateNote(id: string) {
    const url = `${this.settings.baseUrl}/api/uploads/obsidian/sync/${id}`;
    const options: RequestUrlParam = {
      url: url,
      method: 'POST',
      headers: {
		'Authorization': `Bearer ${this.settings.jwtToken}`,
        'Content-Type': 'application/json',
      },
    };

    try {
      const response = await request(options);
      const res = JSON.parse(response);

      if (res.error) {
        throw new Error(res.message);
      }
    } catch (err) {
      new Notice(err.message || 'Unknown error');
    }
  }

  async onload() {
    await this.loadSettings();
    if (this.settings.jwtToken && this.settings.jwtToken !== '') {
      this.fetchNotes();
    } else if (!this.isLoginOpen) {
      setTimeout(() => {
        this.openEmailView();
      }, 200);
    }

    this.registerView(
      VIEW_TYPE_EMAIL,
      (leaf: WorkspaceLeaf) =>
        new EmailView(leaf, (email) => this.handleEmailSubmit(email))
    );

    this.registerView(
      VIEW_TYPE_OTP,
      (leaf: WorkspaceLeaf) =>
        new OTPView(leaf, (otp) => this.handleOTPSubmit(otp))
    );

    this.addCommand({
      id: 'open-email-view',
      name: 'Enter Email',
      callback: () => this.openEmailView(),
    });

    this.addSettingTab(new EpiphanySettingTab(this.app, this));

    this.registerInterval(
      window.setInterval(() => {
        if (this.settings.jwtToken && this.settings.jwtToken !== '') {
          this.fetchNotes();
        } else if (!this.isLoginOpen) {
          this.openEmailView();
        }
      }, 0.5 * 60 * 1000)
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class EpiphanySettingTab extends PluginSettingTab {
  plugin: EpiphanyPlugin;

  constructor(app: App, plugin: EpiphanyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName('Create separate notes')
      .setDesc('Create separate file for each epiphany note')
      .addToggle((value) =>
        value
          .setValue(this.plugin.settings.createSeparateNotes)
          .onChange(async (value) => {
            this.plugin.settings.createSeparateNotes = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
