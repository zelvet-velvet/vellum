<h1 align="center">Vellum</h1>

<p align="center">
  <b>在 Obsidian 裡畫手機畫面，再交給你的 coding agent 照著做。</b>
</p>

<p align="center">
  <a href="README.md">English</a> · <b>繁體中文</b>
</p>

<p align="center">
  <a href="https://github.com/zelvet-velvet/vellum/releases/latest"><img src="https://img.shields.io/github/v/release/zelvet-velvet/vellum?label=release&color=E9892B" alt="最新版本"></a>
  <a href="https://obsidian.md"><img src="https://img.shields.io/badge/Obsidian-%E2%89%A5%201.6.6-7C3AED?logo=obsidian&logoColor=white" alt="Obsidian 1.6.6 以上"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/zelvet-velvet/vellum?color=A3CF7E" alt="MIT 授權"></a>
</p>

<p align="center">
  <img src="assets/banner.svg" width="800" alt="在手機上編輯畫面，Vellum 存成 JSON 檔，agent 讀寫的也是同一批檔案">
</p>

在儲存庫裡，用真實的手機外框排你外掛的畫面。每個畫面存成一個小小的 JSON 檔，agent 打開就知道每樣東西擺在哪，直接照著寫出外掛，不用再截圖、也不用寫一大段說明。顏色、字型和圖示都跟著你的 Obsidian 主題走，所以草稿看起來就已經是外掛的樣子。

<sub>這份 JSON 描述的是「想要怎麼排」，不是原生的版面程式碼。它可以直接對應到 HTML 和 CSS，所以很適合 Obsidian 外掛；SwiftUI 或 Compose 的用法請看[常見問題](#常見問題)。</sub>

<p align="center">
  <a href="#安裝">安裝</a> ·
  <a href="#快速開始">快速開始</a> ·
  <a href="#搭配-agent">搭配 agent</a> ·
  <a href="#檔案格式">檔案格式</a> ·
  <a href="#常見問題">常見問題</a>
</p>

<table>
  <tr>
    <td width="25%"><img src="assets/screens/home.png" alt="首頁，數字是翻牌樣式"></td>
    <td width="25%"><img src="assets/screens/stocks.png" alt="股票畫面"></td>
    <td width="25%"><img src="assets/screens/spending.png" alt="花費畫面"></td>
    <td width="25%"><img src="assets/screens/savings.png" alt="存款畫面"></td>
  </tr>
</table>

<p align="center"><sub>這些是 ZeLedger 的畫面，一個做在 Obsidian 裡的記帳 app，用 Vellum 和 Claude Code 一起設計。數字都是假的。</sub></p>

<p align="center"><img src="assets/editor.png" alt="Vellum 編輯器：左邊是畫面列表，中間是手機，右邊是選到的區塊的設定"></p>

## <img src="assets/icons/star.svg" width="24" height="24" alt=""> 功能

<table>
  <tr>
    <td width="33%" valign="top"><img src="assets/icons/devices.svg" width="32" height="32" alt=""><br><b>真實機型</b><br><sub>iPhone 12 到 17、Pixel 8、Galaxy S24 / S25，也能自訂尺寸。瀏海和安全區域都算進去了。</sub></td>
    <td width="33%" valign="top"><img src="assets/icons/orientation.svg" width="32" height="32" alt=""><br><b>直向和橫向</b><br><sub>兩個方向各排一份，整個編輯器一鍵切換。</sub></td>
    <td width="33%" valign="top"><img src="assets/icons/blocks.svg" width="32" height="32" alt=""><br><b>區塊和錨點</b><br><sub>文字和圖形都記得自己的錨點和位移，尺寸可以是 hug、固定或 fill。</sub></td>
  </tr>
  <tr>
    <td valign="top"><img src="assets/icons/picture.svg" width="32" height="32" alt=""><br><b>圖片和圖示</b><br><sub>圖片用網址或儲存庫裡的路徑，圖示直接寫 Lucide 的名字。</sub></td>
    <td valign="top"><img src="assets/icons/frames.svg" width="32" height="32" alt=""><br><b>共用版型</b><br><sub>多個畫面共用同一個版型，各自只存改過的地方。</sub></td>
    <td valign="top"><img src="assets/icons/magnet.svg" width="32" height="32" alt=""><br><b>自動對齊</b><br><sub>拖曳時會貼齊邊緣、中線、邊距和旁邊的東西，還有參考線。</sub></td>
  </tr>
  <tr>
    <td valign="top"><img src="assets/icons/map.svg" width="32" height="32" alt=""><br><b>畫面地圖</b><br><sub>所有畫面排成一棵樹，看得出每個畫面是從哪裡點進去的。</sub></td>
    <td valign="top"><img src="assets/icons/window.svg" width="32" height="32" alt=""><br><b>獨立視窗</b><br><sub>電腦上是完整的編輯器，手機上設定收在底部面板。</sub></td>
    <td valign="top"><img src="assets/icons/text.svg" width="32" height="32" alt=""><br><b>純 JSON</b><br><sub>一個畫面一個檔案，一個區塊一行，diff 很好讀。</sub></td>
  </tr>
</table>

<p align="center"><img src="assets/map.png" alt="地圖：所有畫面排成一棵樹，看得出是從哪裡點進去的"><br><sub><b>地圖</b>：所有畫面排成一棵樹，mock 用虛線框起來</sub></p>

## <img src="assets/icons/download.svg" width="24" height="24" alt=""> 安裝

- **社群外掛**：準備上架中。
- **[BRAT](https://github.com/TfTHacker/obsidian42-brat)**：新增 beta 外掛 `zelvet-velvet/vellum`。
- **手動安裝**：從[最新版本](https://github.com/zelvet-velvet/vellum/releases/latest)下載 `main.js`、`manifest.json` 和 `styles.css`，放進 `<儲存庫>/.obsidian/plugins/vellum/`，再啟用 **Vellum**。

## <img src="assets/icons/play.svg" width="24" height="24" alt=""> 快速開始

1. 點左側的 **Vellum** 圖示，編輯器會開在 `Screens/` 資料夾。
2. 按 **New Screen** 新增畫面，加一個區塊，再把東西放進去。
3. 按 **Ctrl+S** 存檔。

想先看範例？把 [`examples/Vellum Demo.md`](examples/Vellum%20Demo.md) 複製到你的儲存庫。

## <img src="assets/icons/robot.svg" width="24" height="24" alt=""> 搭配 agent

只要能讀寫檔案的 agent 都行，像 Claude Code、Codex、Cursor。不需要外掛 API，也不用架伺服器。

1. **agent 先打草稿**，把你 app 的畫面畫出來，或提新的畫面。
2. **你在編輯器裡調整**，有要改的地方就留一則 **Note**。
3. **agent 照著改過的畫面寫程式**。

<table>
  <tr>
    <td width="36%" valign="top"><img src="assets/screens/stocks.png" alt="股票畫面"></td>
    <td valign="top">

有比例條的那張卡片，在檔案裡長這樣：

```json
{"name": "Card 2", "kind": "card",
 "x": 16, "y": 397, "w": 396, "h": 182, "items": [
  {"type": "text", "v": "MIX VS YOUR TARGET", "size": 12},
  {"type": "text", "v": "4 WARNINGS", "dx": 286, "color": "dim"},
  {"type": "text", "v": "Stock ETF", "dy": 29, "size": 15},
  {"type": "rect", "dy": 54, "w": 396, "h": 16, "fill": "dim"}
]}
```

一個畫面就是一個小檔案。agent 清楚知道每樣東西在哪，只改需要改的地方。

</td>
  </tr>
</table>

可以直接把這段丟給 agent：

```text
到 github.com/zelvet-velvet/vellum 的 README 看檔案格式。
把我 app 的每一頁寫成 Vellum 畫面，放在 Design/Screens，一個畫面一個 JSON 檔。
文字用真的內容，圖片用 https 網址，圖示用 Lucide 的名字。id 不要隨便改。
卡片的底色和框線用區塊自己的 fill / stroke，標籤或磚塊用文字自己的框，
不要在底下另外疊矩形。
```

> [!TIP]
> 框線屬於它框住的東西：區塊有自己的 `fill`、`stroke` 和 `sides`，文字也有自己的框。舊畫面裡如果有拿矩形當框的，選到它時會出現 **Make it the block's look** 或 **Make it the text's box**，一鍵換掉。
>
> 可以請 agent 多畫兩三個 **mock**（`"mock": true`）當子畫面，留下你喜歡的那個。編輯器開著的時候 agent 一樣可以寫檔：Vellum 會重新載入，不會蓋掉你還沒存的修改。

<sub>[Morellonomicon](https://github.com/zelvet-velvet/Morellonomicon) 和 ZeLedger 的畫面都是這樣和 Claude Code 一起做出來的。</sub>

## <img src="assets/icons/braces.svg" width="24" height="24" alt=""> 檔案格式

```mermaid
flowchart LR
  D["Doc<br/>機型、安全區域"] --> P["Page<br/>一個畫面"]
  P --> B["Block<br/>x, y, w, h, kind"]
  B --> I["Item<br/>text · rect · ellipse · line<br/>img · icon · row · col"]
  P -. "inherit: true" .-> F["上層畫面<br/>當成版型"]
```

一個資料夾裡，每個畫面一個 JSON 檔，另外有一個 `_doc.json` 記機型和畫面順序。在筆記裡這樣顯示：

````markdown
```vellum
src: Design/Screens
```
````

```json
{"id": "home", "name": "Home", "blocks": [
  {"id": "b1", "name": "Title", "kind": "nav", "x": 16, "y": 70, "w": 370, "h": 44, "items": [
    {"id": "t1", "type": "text", "v": "HOME", "font": "display", "size": 32, "g": "l"}]}]}
```

<details>
<summary><b>欄位說明</b></summary>

| 層級 | 欄位 |
| :--- | :--- |
| **Doc** | `device`；`safe`、`safeLand`（`top bottom left right`，都可以省略） |
| **Page** | `name`、`note`、`parent`、`link`（從哪裡進來）、`inherit`（`true`：拿上層畫面當版型）、`device`、`bg`、`mock`、`blocks`、`land`（橫向的排法） |
| **Block** | `name`、`kind`、`note`、`x y w h`（螢幕上的 pt）、`bleed`（`true`：可以伸進安全區域）、自己的外觀：`fill stroke sw r` 和 `sides`（只畫某幾邊的框線：`"b"`、`"tb"`…）、`items` |
| **所有 item** | `g`（錨點：`tl t tr l c r bl b br`）、`dx dy`、`w h`（數字、`"hug"` 或 `"fill"`）、`op`、`note` |
| `text` | `v size wt font color ls lh upper`，也可以有自己的框：`fill stroke sw r pad`（標籤、磚塊、按鈕；有設 `h` 的話文字會置中） |
| `rect` `ellipse` `line` | `fill stroke sw r`（`r`：一個半徑，或四個：`[tl, tr, br, bl]`） |
| `img` | `src`（`https://…` 或儲存庫路徑）、`fit`（`cover` · `contain` · `fill`）、`pos`（CSS 的 object-position）、`r` |
| `icon` | `name`（Lucide）、`color size sw` |
| `row` `col` | `items gap pad main cross`、`fill stroke sw r` |

**版型。** `"inherit": true` 的畫面會先畫上層畫面的區塊，再疊上自己的。自己的區塊如果 `id` 和上層一樣，就會取代上層那一個；畫面本身只存自己的區塊。

**顏色和字型。** item 用主題裡的名稱（`paper text dim line tile loud accent`；`ui display mono`），在「設定 → Vellum」裡設定，也可以直接寫任何 CSS 值。編輯器本身的面板跟著你的 Obsidian 主題，或用同一頁的 Editor theme 自訂顏色。

</details>

## <img src="assets/icons/keyboard.svg" width="24" height="24" alt=""> 快捷鍵

| | |
| :--- | :--- |
| <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> | 移動 1 pt，按住 <kbd>Shift</kbd> 移動一格 |
| <kbd>Ctrl</kbd> <kbd>Z</kbd> · <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Z</kbd> | 復原 · 重做 |
| <kbd>Ctrl</kbd> <kbd>D</kbd> · <kbd>Delete</kbd> | 複製 · 刪除 |
| <kbd>Ctrl</kbd> <kbd>S</kbd> | 存檔 |
| 拖曳時按 <kbd>Alt</kbd> / <kbd>Shift</kbd> | 不吸附 · 維持比例 |
| 按住數字框，再往上 / 往下拖 | 調整數值（點一下可以直接輸入；<kbd>↑</kbd> <kbd>↓</kbd> 一次加減一步，按住 <kbd>Shift</kbd> 一次十步） |

## <img src="assets/icons/question.svg" width="24" height="24" alt=""> 常見問題

<details>
<summary><b>Vellum 會連網路嗎？</b></summary>

只有在顯示 `src` 是 `https://` 網址的圖片時會，跟筆記裡放一張網路圖片一樣。Vellum 自己不會發任何請求。
</details>

<details>
<summary><b>可以拿來做原生的 iOS 或 Android app 嗎？</b></summary>

可以，當成草稿讓 agent 轉過去。區塊裡的東西，排法和原生版面是同一套概念：

| Vellum | SwiftUI | Compose |
| :--- | :--- | :--- |
| 錨點（`g`） | `alignment` | `Alignment` |
| `"hug"` / `"fill"` | `.fixedSize()` / `.frame(maxWidth: .infinity)` | `wrapContentSize()` / `fillMaxWidth()` |
| `row` / `col` | `HStack` / `VStack` | `Row` / `Column` |

區塊本身在畫面上是固定位置，agent 會再把它們轉成 stack 和間距。
</details>

<details>
<summary><b>手機上能用嗎？</b></summary>

可以。編輯器會佔滿整個螢幕，設定收在底部面板。
</details>

<details>
<summary><b>還沒存的修改放在哪？</b></summary>

在這台裝置上，存在 Obsidian 給這個儲存庫的空間裡，直到你存檔為止。
</details>

<details>
<summary><b>要怎麼自己 build？</b></summary>

```sh
npm install && npm run check && npm run build
npm run install-vault -- /path/to/vault
```
</details>

## <img src="assets/icons/coffee.svg" width="24" height="24" alt=""> 贊助

Vellum 是免費的，是我利用空閒時間做的。如果它幫上你的忙，請我喝杯咖啡就能讓它繼續做下去。

<a href="https://ko-fi.com/zelvet_velvet"><img src="assets/kofi-button.svg" alt="在 Ko-fi 請我喝杯咖啡" width="236" height="44"></a>
