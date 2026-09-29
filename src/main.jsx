import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";
import { registerServiceWorker } from "./lib/serviceWorker.js";
import { isNativeApp } from "./lib/platform.js";

if (isNativeApp) document.documentElement.classList.add("native-app");
registerServiceWorker();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
