
<p align="center">
  <img src="https://puppy.im/images/pawtraitlogo.png" width="100%">
</p>

<h1 align="center">Pawtrait 🐾</h1>

<p align="center">
  <b>Image Generation Extension for SillyTavern</b><br/>
  Made with paws, dreams, Redbull and a hint of chaos ✨
</p>

<p align="center">
<img src="https://img.shields.io/github/stars/ThatGirl-me/Pawtrait?style=for-the-badge&label=%E2%AD%90%20stars&color=ff9ecf">
<img src="https://img.shields.io/github/forks/ThatGirl-me/Pawtrait?style=for-the-badge&label=%F0%9F%8D%B4%20forks&color=ffb7d5">
<img src="https://img.shields.io/github/last-commit/ThatGirl-me/Pawtrait?style=for-the-badge&label=%F0%9F%93%85%20last%20commit&color=ffa6cc">
<img src="https://img.shields.io/badge/🦴%20version-v1.0.4-ff9ecf?style=for-the-badge&color=ffa6cc">


</p>

---

## 🐾 About Pawtrait

**Pawtrait** is a SillyTavern extension that blossoms your roleplay into *beautiful visuals*.

Imagine clicking a little paw, then —

✨ a dramatic scene  
✨ a soft anime portrait  
✨ a cozy character moment  

— *boom* — generated straight from your chat.

Built for storytellers, world-builders, and emotional girls with a love for visuals.  
Made with paws. Made with love. 🐾💗

---
## 🔄 Updates 

### 🆕 What’s New — v1.0.4

Pawtrait v1.0.4 brings safer gallery storage, better reliability, and clearer behavior around saved image files ✨


✨ New & Improved

1. 🗂️ Safer Gallery Image Storage
  - Legacy base64 gallery entries are migrated to disk-backed files more safely during load.

2. 🛡️ Better Gallery Hardening
  - Gallery image paths are validated before use.
  - Prompt text and image URLs are escaped before rendering in the gallery popup/grid.

3. ✅ More Reliable Generation Flow
  - Image generation no longer shows a false failure just because gallery persistence fails.

4. 🖼️ Better File Type Handling
  - Saved gallery files now use mime-aware extensions instead of assuming every image is PNG.

5. ℹ️ Clearer File Cleanup Expectations
  - Removing gallery entries does not delete local files automatically.
  - The UI now makes that behavior explicit.



---


## ✨ Features

- 🐕 Multi-provider image generation  
- 🖼️ Avatar references for character consistency  
- 🧾 Optional AI summarizer to craft clean prompts  
- 📚 Context depth (multi-message scenes)  
- ♻️ Previous image recall for continuity  
- 🗂️ Built-in gallery  
- ⌨️ Slash commands  
- 🐾 One-click generate buttons under messages


Providers supported:
- NanoGPT
- OpenRouter
- LinkAPI.ai
- Pollinations.ai
- Custom OpenAI-compatible endpoints

---

## 📦 Installation

### Via SillyTavern

1. Open SillyTavern
2. Go to Extensions
3. Click Install Extension
4. Paste:

https://github.com/ThatGirl-me/Pawtrait

5. Reload

---

## 🚀 Quick Start

1. Open **Extensions → Pawtrait 🐾**
2. Go to **Connection**
3. Pick a **Provider**
4. Paste your **API Key**
5. Hit **Fetch Models**
6. Pick your **Model**

Then:
✨ Click 🐾 under a message  
✨ Edit prompt (optional)  
✨ Generate and enjoy 🎨

---

## ⚙️ Settings

### 🔌 Connection
- Choose Provider
- Add API Key (per provider)
- Fetch Models
- Optionally: enable AI summarizer

### 👤 Characters
- Add your **Character visual overrides**
- Add **Persona visual overrides**
- Store per-character/paw

### 🎨 Generation
- Aspect ratio
- Context message depth
- Use avatar references
- Include persona/character visuals
- Link with previous image
- Style/system prefix
- Prompt length cap


### 🖼️ Gallery
- Browse all generated images
- View fullscreen
- Delete individual or clear all


---

## 🐶 Usage

### 🐾 From Message
Click the **paw icon (🐾)** under any message to spawn new art.

Perfect for:
- Dramatic scenes  
- Intimate glances  
- Cute outfits  
- Quiet moments  
- …all the soft and chaotic feelings 💗

### ⌨️ Slash Commands

```text
/pawtrait soft pastel anime portrait, gentle lighting
/pawimg cinematic rain, neon glow, dramatic vibe
```

---

### 🔐 Privacy

- API keys stay local to SillyTavern’s settings
- Requests go only to your selected provider
- Just paws & pixels 🐾

---

## 📸 Reference Images (Heads Up!)

Not all models can accept reference images (avatars / previous art).

If you want consistency — choose a model that supports it.

Pawtrait shows support indicators so you’ll always know!


## 🩹 Troubleshooting

### No Models
- Check key
- Fetch again

### Bad Output
- Enable visuals
- Change model

---

## 💖 Contributing

PRs welcome with open paws 🐾

---

## 📜 License

MIT
Play nice. Be kind. 🐾💗

---

## ❤ Author

Made by ThatGirl / Puppy

For storytellers, dreamers, and soft girls with messy imaginations 🐾✨

“Made with paws and spite.”
