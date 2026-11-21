"use strict";
document.getElementById("new").addEventListener("click", async () => {
  const button = document.getElementById("new");
  button.disabled = true;
  try {
    await browser.tabs.create({ url: browser.runtime.getURL("terminal.html") });
    window.close();
  } catch (e) {
    button.disabled = false;
    document.querySelector(".hint").textContent = e.message;
  }
});
