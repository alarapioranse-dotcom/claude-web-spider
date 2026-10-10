# Claude Web Spider

A userscript that draws a digital spider over [claude.ai](https://claude.ai). While Claude writes, the spider follows the newest words. When a link or a search source appears in a reply, it jumps there and weaves an animated red / yellow / green thread, building a web as the conversation goes on.

## Install

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension (Firefox for Android, Firefox, Chrome, Edge).
   - Chrome: open `chrome://extensions`, open Tampermonkey's **Details**, and turn on **Allow User Scripts**.
2. Open this link and press **Install**:

   https://raw.githubusercontent.com/alarapioranse-dotcom/claude-web-spider/main/claude-web-spider.user.js

3. Open https://claude.ai in that browser.

## Use

- The small 🕷️ button at the bottom-left shows or hides the spider. The choice is remembered.
- The web is cleared when you switch to another chat.
- Respects the system "reduce motion" setting.

## Limits

- Works in a web browser only, not inside the Claude mobile or desktop apps.
- It reads the claude.ai page layout. If that layout changes, the script may need an update.
