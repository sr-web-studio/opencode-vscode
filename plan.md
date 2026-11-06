I like OpenCode a lot. I use it like this,

- I have a Ubuntu service running opencode permanently. on port 4096. with a known password. Accessible over LAN/Tailscale.
- I then use opencode using browser on Laptop and Mobile. The best thing about this is that, even if I close the browser, the sessions keeps running and I can pick it up exactly from where it's currently in even after hours. Awesome harness.

The only thing I miss a lot is a useful VS Code extension that lets me use OpenCode within VS Code's ecosystem. I want to fix that. Lets build one for myself and codebase in a way so may be we can publish it as well.

I want my opencode extesnion to use some of VS Code's features,

- I should be able to open created/edited files on the editor cliking the file links.
- I should see diffs in the editor as well for the edited files.
- The terminal tools are the big ones. I want to see them running in the terminal panel of VS code editor, same as copilot chat does. Also, the ability to stop a command myself if needed. Give input if needed like press y, n etc.
- Model, provider, MCPs, Skills all managed by opencode and we don't break or alter their ecosystem.
- Opencode has this awesome ability to keep workers and shell commands running in the background. And be able to continue main agent conversation. If conversation goes quite, background events can wake up the main agent when finished. Again awesome stuffs. I want to have the same flexibility.
  - The workers read only sessions should appear as expandable list, where clicking one should open the session(s) as tab on the editor area.
  - Main session remains in the extension panel.

For now, we don't ship a opencode runtime with the extension. We assume CLI is there, and it's running using serve command. If CLI not present, we ask user to that first. If serve command isn't running, we run it when extesnion spin up. Current project folder becomes a project on opencode, and sessions are already managed by opencode.

Closing VS code should never break the session. That's the most important part.

Opencode latest version from v2. I would like to see a few image mock ups to decide about the UI. Please use `~/ai-clis` for generating some.
