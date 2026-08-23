import client from "react-dom/client"
import { StrictMode } from "react"
import View from "./view/view"

const root = client.createRoot(document.body)

root.render(<StrictMode><View /></StrictMode>)
