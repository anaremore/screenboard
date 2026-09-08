# Screenboard privacy policy

Effective date: September 7, 2026

Screenboard is a local-first Chrome extension that captures a selected area, page element, visible viewport, or complete web page and copies the resulting PNG to the clipboard.

## Data Screenboard handles

When the user starts a capture, Screenboard processes the pixels visible on the selected webpage. A screenshot can contain website content, including personal or user-generated content visible on that page. Screenboard also stores extension settings, short-lived capture diagnostics, and screenshot images and thumbnails for enabled history or recovery after a failed delivery.

## How data is used

Screenboard uses captured pixels only to create the screenshot requested by the user, copy it to the clipboard, save it when requested, and maintain the local recent-capture list. Settings are used only to apply the user's download and history preferences.

## Storage, retention, and deletion

Screenboard first holds each PNG in memory while it attempts to copy it and, if enabled, download it. Screenshot delivery does not require permanent history storage.

When recent history is enabled, screenshot images and thumbnails are stored in the browser's local extension storage. When history is disabled, new captures are discarded after a successful clipboard write or completed download. If neither delivery succeeds, Screenboard keeps a recovery copy in Recent so the user can try again. Turning history off does not delete existing captures; use Clear capture history to remove them.

Stored captures, including recovery copies, remain until the user deletes them, clears history, reaches the configured count or 250 MiB storage limit, or uninstalls the extension. If a PNG is too large for history or local storage fails, Screenboard may keep a temporary copy in memory and labels it as session-only. These temporary copies are limited, may be removed as newer captures arrive, and do not survive the extension or browser restarting. Save any temporary capture you want to keep.

Settings remain until changed, cleared with browser data, or removed by uninstalling Screenboard. Session diagnostics expire with the browser session.

## Sharing and transmission

Screenboard does not send screenshots, page content, browsing activity, settings, or capture metadata to the developer or any external service. It has no account system, analytics, advertising, telemetry, or remote processing. Screenboard does not sell user data or share it with third parties. The developer cannot access locally stored captures.

## Permissions

Screenboard uses Chrome permissions only for user-requested capture features: temporary access to the active tab, on-demand page scripts for selection and full-page capture, local storage, offscreen image processing, clipboard writing, and optional PNG downloads.

## Chrome Web Store Limited Use

Screenboard's use of information complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Information is used only to provide or improve Screenboard's single screenshot-capture purpose. It is not used for advertising, creditworthiness, lending, or any unrelated purpose, and humans are not given access to it.

## Changes

Material changes to this policy will be published in this file with a revised effective date before the related extension update is distributed.

## Contact

Questions or privacy requests can be opened at <https://github.com/anaremore/screenboard/issues>.
