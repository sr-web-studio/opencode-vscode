import "@vscode/codicons/dist/codicon.css"
import { mount } from "svelte"
import App from "@occ/ui/App.svelte"
import { createVsCodeBridge, postViewMetrics } from "./vscode-bridge"
import { reportViewMetrics } from "./view-metrics"

mount(App, { target: document.getElementById("app")!, props: { bridge: createVsCodeBridge() } })
reportViewMetrics(postViewMetrics)
