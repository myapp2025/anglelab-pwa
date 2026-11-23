# AngleLab – PWA Research Camera

A Progressive Web App version of AngleLab. Install on iPhone or Android Home Screen **without** the App Store / Play Store.

## Features

- 📷 Rear camera capture (getUserMedia)
- 🧭 Live Yaw / Pitch / Roll (DeviceOrientation API)
- 🎯 Relative orientation from user-set reference (quaternion math)
- 📸 **Save original and annotated photos to your phone's Gallery / Photos**
- 💾 IndexedDB local storage (sessions, photos, metadata)
- 📤 Export JSON / CSV / ZIP (photos + metadata bundled)
- 📴 Fully offline after first load
- 🔒 No tracking, no uploads, no analytics

## 🚀 Deploy (GitHub Pages – free HTTPS)

1. Create a new GitHub repo, e.g. `anglelab-pwa`.
2. Push the contents of this folder to the `main` branch:
   ```bash
   git init
   git add .
   git commit -m "Initial AngleLab PWA"
   git branch -M main
   git remote add origin https://github.com/YOUR_USER/anglelab-pwa.git
   git push -u origin main