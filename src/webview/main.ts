import { mount } from "svelte"
import App from "../ui/App.svelte"
import { createVsCodeBridge } from "./vscode-bridge"

mount(App, { target: document.getElementById("app")!, props: { bridge: createVsCodeBridge() } })
