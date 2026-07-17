/**
 * Records a short SmolNotes demo (webm + gif) against a local URL.
 *
 * Requires Playwright available to Node (e.g. `npm i playwright` in a temp
 * dir, or a local install) and system Chrome. Also needs `python3` + Pillow
 * for the GIF.
 *
 * Usage: node scripts/record-demo.mjs [url]
 */
import { chromium } from "playwright";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "assets");
const framesDir = path.join(outDir, ".demo-frames");
const url = process.argv[2] ?? "http://127.0.0.1:3000";

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureFrame(page, frames, label) {
  const file = path.join(framesDir, `${String(frames.length).padStart(3, "0")}-${label}.png`);
  await page.screenshot({ path: file, type: "png" });
  frames.push(file);
  console.log(`frame: ${label}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const videoDir = path.join(outDir, ".demo-video");
  await rm(videoDir, { recursive: true, force: true });
  await mkdir(videoDir, { recursive: true });

  console.log(`recording demo from ${url}`);

  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: videoDir,
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();
  const frames = [];

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

  console.log("waiting for model / editor…");
  const editor = page.locator(".note-editor__input");
  const error = page.locator(".boot__error");

  // Race: ready editor vs hard error
  const outcome = await Promise.race([
    editor.waitFor({ state: "visible", timeout: 10 * 60_000 }).then(() => "ready"),
    error.waitFor({ state: "visible", timeout: 10 * 60_000 }).then(() => "error"),
  ]);

  if (outcome === "error") {
    const message = (await error.textContent())?.trim() ?? "unknown error";
    await context.close();
    await browser.close();
    throw new Error(`SmolNotes failed to boot: ${message}`);
  }

  await sleep(800);
  await captureFrame(page, frames, "ready");

  await editor.click();
  const lines = [
    "morning light on the desk,",
    "a half-finished sentence waiting",
  ];

  for (const [i, line] of lines.entries()) {
    await editor.pressSequentially(line, { delay: 45 });
    await captureFrame(page, frames, `typed-${i}`);
    await sleep(900);
    await captureFrame(page, frames, `pause-${i}`);

    const ghost = page.locator(".note-editor__ghost");
    try {
      await ghost.waitFor({ state: "visible", timeout: 12_000 });
      await sleep(700);
      await captureFrame(page, frames, `ghost-${i}`);
      if (i === 0) {
        await page.keyboard.press("Tab");
        await sleep(500);
        await captureFrame(page, frames, "accepted");
        await editor.press("Enter");
      } else {
        await sleep(900);
      }
    } catch {
      console.log("no ghost this round; continuing");
      if (i === 0) await editor.press("Enter");
    }
  }

  await sleep(1200);
  await captureFrame(page, frames, "end");

  const videoPath = await page.video()?.path();
  await context.close();
  await browser.close();

  if (videoPath) {
    const dest = path.join(outDir, "demo.webm");
    await rename(videoPath, dest);
    console.log(`wrote ${dest}`);
  }

  // Assemble GIF with Pillow
  const gifScript = `
from pathlib import Path
from PIL import Image

frames_dir = Path(${JSON.stringify(framesDir)})
out = Path(${JSON.stringify(path.join(outDir, "demo.gif"))})
paths = sorted(frames_dir.glob("*.png"))
images = []
for p in paths:
    im = Image.open(p).convert("P", palette=Image.ADAPTIVE, colors=128)
    # half-res for README weight
    im = im.resize((im.width // 2, im.height // 2), Image.Resampling.LANCZOS)
    images.append(im)
if not images:
    raise SystemExit("no frames")
images[0].save(
    out,
    save_all=True,
    append_images=images[1:],
    duration=180,
    loop=0,
    optimize=True,
)
print(f"wrote {out} ({len(images)} frames)")
`;
  const pyPath = path.join(outDir, ".make-gif.py");
  await writeFile(pyPath, gifScript);
  const py = spawnSync("python3", [pyPath], { encoding: "utf8" });
  if (py.status !== 0) {
    console.error(py.stdout);
    console.error(py.stderr);
    throw new Error("gif encode failed");
  }
  console.log(py.stdout.trim());

  await rm(framesDir, { recursive: true, force: true });
  await rm(videoDir, { recursive: true, force: true });
  await rm(pyPath, { force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
