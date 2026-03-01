const { app, BrowserWindow, nativeImage } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createScreenTools, formatScreenResult } = require("./screenControl.cjs");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.disableHardwareAcceleration();
const profile = path.join(__dirname, "profile");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 800,
      height: 650,
      title: "MCP visual-control verification",
      webPreferences: { backgroundThrottling: false },
    });
    const html = `<style>body{margin:0;height:1800px;background:#19202a;color:white}button,input{position:absolute;left:40px;width:180px;height:40px}button{top:40px}input{top:110px}canvas{position:absolute;left:40px;top:190px;background:#45a4ce}</style><button id="button">Click me</button><input id="input"><canvas id="canvas" width="250" height="100"></canvas><script>window.clicks=0;window.moves=0;button.onclick=()=>window.clicks++;canvas.onpointerdown=e=>{window.dragStart=[e.offsetX,e.offsetY];canvas.setPointerCapture(e.pointerId)};canvas.onpointermove=e=>{if(e.buttons)window.moves++};canvas.onpointerup=e=>window.dragEnd=[e.offsetX,e.offsetY];</script>`;
    await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    await delay(300);
    const tools = createScreenTools(() => window);
    const run = async (name, args) => {
      const tool = tools.find((entry) => entry.name === name);
      return await tool.run(tool.schema.parse(args));
    };
    const point = async (id, screenshot, dx = 0, dy = 0) => {
      const target = await window.webContents.executeJavaScript(
        `(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:innerWidth,h:innerHeight}})()`
      );
      return {
        x: ((target.x + dx) * screenshot.imageWidth) / target.w,
        y: ((target.y + dy) * screenshot.imageHeight) / target.h,
      };
    };
    for (const zoom of [1, 1.5]) {
      window.webContents.setZoomFactor(zoom);
      await delay(150);
      let screenshot = await run("fland_screenshot", { maxWidth: 400, maxHeight: 400 });
      const encodedSize = nativeImage
        .createFromBuffer(Buffer.from(screenshot.image.data, "base64"))
        .getSize();
      assert.deepEqual(encodedSize, {
        width: screenshot.imageWidth,
        height: screenshot.imageHeight,
      });
      assert.equal(formatScreenResult("fland_screenshot", screenshot).content[1].type, "image");
      const previous = await window.webContents.executeJavaScript("window.clicks");
      let result = await run("fland_ui_input", {
        action: "click",
        screenshotId: screenshot.screenshotId,
        point: await point("button", screenshot),
      });
      assert.equal(
        await window.webContents.executeJavaScript("window.clicks"),
        previous + 1,
        `Click mapping failed at zoom ${zoom}`
      );
      screenshot = result.observation;
      result = await run("fland_ui_input", {
        action: "click",
        screenshotId: screenshot.screenshotId,
        point: await point("input", screenshot),
      });
      screenshot = result.observation;
      await run("fland_ui_input", {
        action: "key",
        screenshotId: screenshot.screenshotId,
        key: "A",
        modifiers: [process.platform === "darwin" ? "meta" : "control"],
        screenshotAfter: false,
      });
      result = await run("fland_ui_input", {
        action: "type",
        screenshotId: screenshot.screenshotId,
        text: "Runde 日本語",
      });
      assert.equal(
        await window.webContents.executeJavaScript("document.getElementById('input').value"),
        "Runde 日本語"
      );
      screenshot = result.observation;
      result = await run("fland_ui_input", {
        action: "drag",
        screenshotId: screenshot.screenshotId,
        point: await point("canvas", screenshot, -80, 0),
        to: await point("canvas", screenshot, 80, 0),
        durationMs: 150,
      });
      const drag = await window.webContents.executeJavaScript(
        "({start:window.dragStart,end:window.dragEnd,moves:window.moves})"
      );
      assert(
        drag.end[0] > drag.start[0] + 140 && drag.moves > 0,
        `Canvas drag failed at zoom ${zoom}`
      );
      screenshot = result.observation;
      result = await run("fland_ui_input", {
        action: "scroll",
        screenshotId: screenshot.screenshotId,
        point: { x: screenshot.imageWidth - 10, y: screenshot.imageHeight - 10 },
        scrollY: 250,
        settleMs: 300,
      });
      assert(await window.webContents.executeJavaScript("scrollY > 0"), "Scrolling failed");
      await window.webContents.executeJavaScript("scrollTo(0,0)");
    }
    console.log(
      "Visual verification passed: screenshots, scaled/zoomed clicks, Unicode typing, keyboard shortcuts, canvas dragging and scrolling."
    );
    window.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
