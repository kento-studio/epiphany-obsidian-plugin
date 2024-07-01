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
// Remember to rename these classes and interfaces!

interface MyPluginSettings {
  mySetting: string;
  jwtToken: string | null;
  createSeparateNotes: boolean;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  mySetting: 'default',
  jwtToken: 'testing test',
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

export default class MyPlugin extends Plugin {
  settings: MyPluginSettings;
  private authRequestId: string | null = null;
  private jwtToken: string | null = null; // Declare jwtToken here

  async openEmailView() {
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
    // Make API request to send OTP to the email
    const url = `https://98d0-81-133-73-3.ngrok-free.app/api/auth/login`;
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
    // Handle OTP submission logic
    if (!this.authRequestId) {
      new Notice('No auth request ID found. Please start the process again.');
      return;
    }

    const url = `https://98d0-81-133-73-3.ngrok-free.app/api/auth/verify-code`;
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

      this.jwtToken = res.jwt_token;

      this.settings.jwtToken = res.jwt_token;
      await this.saveSettings();

      this.app.workspace.detachLeavesOfType(VIEW_TYPE_OTP);
      new Notice('Login successful!');
    } catch (err) {
      new Notice(err.message || 'Unknown error');
    }
  }

  async fetchNotes() {
    // Make API request to send OTP to the email
    const url = `https://98d0-81-133-73-3.ngrok-free.app/api/uploads/obsidian`;
    const options: RequestUrlParam = {
      url: url,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': '69420',
        user: `${this.settings.jwtToken}`,
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

    // If the file doesn't exist, create it
    if (!combinedFile) {
      combinedFile = await this.app.vault.create(combinedFilePath, '');
    }

    // Read the current content of the file
    let combinedContent = await this.app.vault.read(combinedFile);

    // Append each note to the combined content
    res.forEach(async (upload) => {
      const noteContent = `## ${upload.label} \n ${upload.transcription} \n [audio](${upload.url})\n\n`;
      combinedContent += noteContent;
      await this.updateNote(upload.id);
    });

    // Write the combined content back to the file
    await this.app.vault.modify(combinedFile, combinedContent);
  }

  async updateNote(id: string) {
    const url = `https://98d0-81-133-73-3.ngrok-free.app/api/uploads/obsidian/sync/${id}`;
    const options: RequestUrlParam = {
      url: url,
      method: 'POST',
      headers: {
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
    } else {
      new Notice('please login to epiphany plugin');
      this.openEmailView();
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

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new SampleSettingTab(this.app, this));

    // If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
    // Using this function will automatically remove the event listener when this plugin is disabled.
    this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
      console.log('click', evt);
    });

    // When registering intervals, this function will automatically clear the interval when the plugin is disabled.
    this.registerInterval(
      window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000)
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class SampleSettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName('Setting #1')
      .setDesc("It's a secret")
      .addText((text) =>
        text
          .setPlaceholder('Enter your secret')
          .setValue(this.plugin.settings.mySetting)
          .onChange(async (value) => {
            this.plugin.settings.mySetting = value;
            await this.plugin.saveSettings();
          })
      );

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
