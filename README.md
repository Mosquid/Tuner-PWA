# Strum Guitar Tuner

A microphone-powered, installable guitar tuner PWA built with Vite, Web Audio, and JustGage.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL, press **Start tuning**, and allow microphone access. Microphone access works on localhost or HTTPS.

## Features

- Automatic guitar-string detection
- ±50-cent animated JustGage tuning meter
- Standard, Drop D, half-step down, Open G, and DADGAD tunings
- Adjustable A4 concert pitch (420–460 Hz)
- Playable reference tones for every string
- On-device pitch detection; no audio is uploaded
- Responsive, installable PWA with offline app shell
