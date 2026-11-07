import "@vscode/codicons/dist/codicon.css"
import "./theme.css"
import "./mobile.css"
import { mount } from "svelte"
import Root from "./Root.svelte"
import { setupChrome } from "./lib/platform"

setupChrome()
mount(Root, { target: document.getElementById("app")! })
