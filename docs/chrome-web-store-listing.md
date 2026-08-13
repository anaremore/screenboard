# Chrome Web Store listing

This is the submission copy for Screenboard 0.1.1. The upload file is `dist/screenboard-v0.1.1-chrome-web-store.zip`; upload the ZIP itself, without extracting it.

## Store listing

| Field | Fill in |
| --- | --- |
| Product name | `Screenboard` |
| Summary | `Capture any area, element, viewport, or page and paste it anywhere.` |
| Category | `Productivity` |
| Language | `English (United States)` |
| Homepage URL | `https://github.com/anaremore/screenboard` |
| Support URL | `https://github.com/anaremore/screenboard/issues` |
| Official URL | Leave blank unless you have verified a domain in the developer dashboard. |

### Detailed description

```text
Screenboard makes screenshots ready to paste the moment a capture finishes.

Capture exactly what you need:
• Drag over any area of a page
• Capture the visible browser viewport
• Capture an entire scrollable page
• Point to and capture a specific page element

Every successful capture is automatically copied as a PNG and confirmed on the page. Open Recent to copy it again, save it as a PNG, or delete it. Settings let you enable automatic downloads and choose how many recent captures to keep.

Private by design:
• No account
• No external server or upload step
• No analytics or advertising
• Screenshots and recent history remain in local browser storage

Area and visible captures include keyboard shortcuts. Chrome does not allow extensions to inject selection tools into protected pages such as chrome:// pages or the Chrome Web Store.
```

## Graphic assets

Upload these exact files:

| Dashboard slot | File |
| --- | --- |
| Store icon, 128 × 128 | `store-assets/icon-128.png` |
| Screenshot 1, 1280 × 800 | `store-assets/screenshots/01-copied-to-clipboard.png` |
| Screenshot 2, 1280 × 800 | `store-assets/screenshots/02-select-an-area.png` |
| Screenshot 3, 1280 × 800 | `store-assets/screenshots/03-capture-an-element.png` |
| Screenshot 4, 1280 × 800 | `store-assets/screenshots/04-popup-and-recents.png` |
| Screenshot 5, 1280 × 800 | `store-assets/screenshots/05-settings-and-privacy.png` |
| Small promotional tile, 440 × 280 | `store-assets/small-promo-440x280.png` |
| Marquee promotional tile, 1400 × 560 | `store-assets/marquee-promo-1400x560.png` |

A YouTube video is optional. The marquee promotional tile is also optional, but this kit includes one.

## Privacy practices

### Single purpose

```text
Screenboard lets users capture a selected area, page element, visible viewport, or complete web page and copy the resulting PNG directly to the clipboard.
```

### Permission justifications

| Permission | Justification |
| --- | --- |
| `activeTab` | Gives Screenboard temporary access only to the current tab after the user starts a capture, so it can capture the visible page without permanent access to browsing activity. |
| `scripting` | Injects the selection overlay or full-page capture coordinator into the current tab only after the user requests that capture. |
| `storage` | Stores user settings, capture job diagnostics, and recent screenshot history locally in the browser. |
| `offscreen` | Uses a hidden extension document to crop and stitch image data, create thumbnails, and manage local screenshot storage without opening another visible tab. |
| `clipboardWrite` | Writes the completed PNG to the system clipboard so it is immediately ready to paste. |
| `downloads` | Saves a PNG when the user clicks Save or enables automatic saving. |

### Remote code

Select **No, I am not using remote code**.

Suggested justification if the dashboard asks for one:

```text
All executable JavaScript is packaged with the extension. Screenboard does not download or execute remote code, use eval-like execution, or load scripts from external services.
```

### User data

Select **Website content** because screenshot pixels are page content, even though Screenboard processes and stores them only on the user's device. Do not select web history: Screenboard does not store or transmit visited URLs or browsing history. If the dashboard wording separately asks whether captured user-created material is handled, also select **User-generated content**; it can appear inside screenshots.

For each applicable data type, select only:

- Used for **App functionality**.
- Data is **not sold**.
- Data is **not used or transferred for purposes unrelated to Screenboard's single purpose**.
- Data is **not used or transferred for creditworthiness or lending**.
- Data is **not transmitted off the user's device**.

Check all three Limited Use certification boxes. Screenboard has no advertising, analytics, external processing, or developer access to screenshot data.

### Privacy policy

Use this URL:

```text
https://github.com/anaremore/screenboard/blob/main/PRIVACY.md
```

The repository is public, so the policy can be opened without signing in.

## Distribution

| Field | Fill in |
| --- | --- |
| Visibility | `Public` |
| Regions | `All regions` unless you have a business reason to limit distribution |
| Mature content | `No` |
| Pricing | `Free` |

Before submitting, open every listing URL in a signed-out browser window, verify the five screenshots appear in the intended order, and run the dashboard's automated checks.
