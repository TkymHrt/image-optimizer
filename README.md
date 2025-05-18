# image-optimizer

## 概要

指定ディレクトリ内の画像ファイルを一括で最適化・変換するツールです。
ビルド後に画像をWebPやAVIFなどに変換し、参照パスも自動で置換します。

## 使い方

### 1. ビルドスクリプトの例

`package.json`の`scripts`に以下のように追記してください:

```json
{
  "scripts": {
    "build": "tsc -b && vite build && node image-optimizer/image-optimizer.js"
  }
}
```

### 2. 画像ディレクトリや出力形式を変更したい場合

`image-optimizer.js`の`buildDir`と`outputFormat`を変更してください。

- `buildDir` … 画像を変換するディレクトリ（デフォルト: `dist`）
- `outputFormat` … 変換後の画像形式（`webp`, `avif`）

### 3. 変換対象の拡張子

デフォルトで`.png`, `.jpg`, `.jpeg`, `.webp`が対象です。

---

## 注意

- 変換後、元画像はデフォルトで削除されます（`removeOriginal: true`）。
- 画像参照パスも自動で変換後の拡張子に置換されます。

---
