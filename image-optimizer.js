import sharp from "sharp";
import { globSync } from "glob";
import fs from "fs";
import path from "path";
import { replaceInFile } from "replace-in-file";
import prettyBytes from "pretty-bytes";

// 画像変換設定
const config = {
  buildDir: "dist",
  targetExtensions: [".png", ".jpg", ".jpeg", ".webp"],
  outputFormat: "webp",
  formatOptions: {
    avif: {
      quality: 50,
      lossless: false,
      effort: 4,
    },
    webp: {
      quality: 80,
      lossless: false,
      effort: 4,
    },
  },
  removeOriginal: true,
  concurrency: 4,
};

// コード内で色を直接使用するための変数
const COLORS = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
};

// 画像ファイル検索
function getImageFiles(dir, exts) {
  const pattern = path.join(
    dir,
    `**/*.{${exts.map((e) => e.slice(1)).join(",")}}`,
  );
  return globSync(pattern, { nodir: true });
}

// 出力形式から拡張子を取得
function getOutputExtension(format) {
  return format.toLowerCase() === "jpeg" ? ".jpg" : `.${format.toLowerCase()}`;
}

// 単一画像を指定形式に変換
async function convertImage(filePath, outputFormat, formatOptions) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const outputExt = getOutputExtension(outputFormat);
  const outPath = path.join(dir, base + outputExt);

  let originalSize = 0;
  try {
    originalSize = fs.statSync(filePath).size;
  } catch (e) {
    logWarn(`ファイルサイズ取得失敗: ${filePath} - ${e.message}`);
  }

  try {
    let sharpInstance = sharp(filePath);
    if (["jpeg", "jpg"].includes(outputFormat)) {
      sharpInstance = sharpInstance.jpeg(formatOptions.jpeg);
    } else if (outputFormat === "avif") {
      sharpInstance = sharpInstance.avif(formatOptions.avif);
    } else if (outputFormat === "webp") {
      sharpInstance = sharpInstance.webp(formatOptions.webp);
    } else if (outputFormat === "png") {
      sharpInstance = sharpInstance.png(formatOptions.png);
    } else {
      throw new Error(`サポートされていない出力フォーマット: ${outputFormat}`);
    }

    await sharpInstance.toFile(outPath);

    let convertedSize = 0;
    try {
      convertedSize = fs.statSync(outPath).size;
    } catch (e) {
      logWarn(`変換後ファイルサイズ取得失敗: ${outPath} - ${e.message}`);
    }
    return {
      original: filePath,
      converted: outPath,
      success: true,
      originalSize,
      convertedSize,
    };
  } catch (error) {
    return {
      original: filePath,
      success: false,
      error,
      originalSize,
    };
  }
}

// 並列画像変換処理
async function processImagesInBatches(
  images,
  outputFormat,
  formatOptions,
  concurrency,
) {
  const results = [];
  const total = images.length;
  let processedCount = 0;

  for (let i = 0; i < total; i += concurrency) {
    const batch = images.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((img) => convertImage(img, outputFormat, formatOptions)),
    );
    results.push(...batchResults);
    processedCount += batch.length;
  }
  return results;
}

// 元画像ファイル削除
function removeOriginalFiles(results, shouldRemove) {
  if (!shouldRemove) return;
  for (const result of results) {
    if (result.success && fs.existsSync(result.original)) {
      try {
        fs.unlinkSync(result.original);
      } catch (e) {
      }
    }
  }
}

// 画像参照パス置換
async function replaceImageReferences(buildDir, targetExts, outputFormat) {
  const pattern = path.join(buildDir, `**/*.{html,css,js,json,xml,svg}`);
  const files = globSync(pattern, { nodir: true });
  if (files.length === 0) return;
  const fromRegex = new RegExp(
    `\\.(${targetExts.map((e) => e.slice(1)).join("|")})`,
    "g",
  );
  const outputExt = getOutputExtension(outputFormat);
  try {
    const results = await replaceInFile({
      files,
      from: fromRegex,
      to: outputExt,
      countMatches: true,
    });
    const changedFiles = results.filter((r) => r.hasChanged);
    const totalMatches = changedFiles.reduce(
      (sum, r) => sum + (r.numMatches || 0),
      0,
    );
    if (changedFiles.length > 0) {
      console.log(
        `${COLORS.green}[SUCCESS]${COLORS.reset} ${changedFiles.length}ファイル内の ${totalMatches}箇所を'${outputExt}'に更新しました`,
      );
      changedFiles.forEach((r) => console.log(`  - ${r.file}`));
    }
  } catch (err) {
    console.error(
      `${COLORS.red}[ERROR]${COLORS.reset} 参照置換中にエラー発生: ${err.message}`,
    );
  }
}

// 圧縮結果出力
function printOptimizationResults(results) {
  const succeeded = results.filter((r) => r.success);
  if (succeeded.length === 0) return;
  let totalOriginalSize = 0;
  let totalConvertedSize = 0;
  const headerFileName = "File Name";
  const headerReduction = "Reduction";
  const headerSizeChange = "Size (Original → New)";
  const fileNameColWidth = Math.max(
    headerFileName.length,
    ...succeeded.map((r) => path.basename(r.original).length),
  );
  const reductionColWidth = Math.max(
    headerReduction.length,
    ...succeeded.map((r) => {
      const reductionPercentage =
        r.originalSize > 0
          ? Math.round(
              ((r.originalSize - r.convertedSize) / r.originalSize) * 100,
            )
          : 0;
      return `${reductionPercentage > 0 ? "-" : ""}${Math.abs(reductionPercentage)}%`
        .length;
    }),
  );
  const sizeChangeColWidth = Math.max(
    headerSizeChange.length,
    ...succeeded.map((r) => {
      const originalStr = prettyBytes(r.originalSize || 0);
      const convertedStr = prettyBytes(r.convertedSize || 0);
      return `${originalStr} → ${convertedStr}`.length;
    }),
  );

  // ヘッダー出力
  console.log("");
  console.log(
    `${headerFileName.padEnd(fileNameColWidth)}  ` +
      `${headerReduction.padStart(reductionColWidth)}  ` +
      `${headerSizeChange.padEnd(sizeChangeColWidth)}`,
  );
  console.log(
    `${"-".repeat(fileNameColWidth)}  ` +
      `${"-".repeat(reductionColWidth)}  ` +
      `${"-".repeat(sizeChangeColWidth)}`,
  );

  // データ行出力
  for (const r of succeeded) {
    const originalSize = r.originalSize || 0;
    const convertedSize = r.convertedSize || 0;
    const reductionPercentage =
      originalSize > 0
        ? Math.round(((originalSize - convertedSize) / originalSize) * 100)
        : 0;
    const fileNameStr = path.basename(r.original).padEnd(fileNameColWidth);
    let reductionStr = `${reductionPercentage > 0 ? "-" : ""}${Math.abs(reductionPercentage)}%`;
    if (reductionPercentage > 0) {
      reductionStr = `${COLORS.green}${reductionStr}${COLORS.reset}`;
    } else if (reductionPercentage < 0) {
      reductionStr = `${COLORS.red}${reductionStr}${COLORS.reset}`;
    }
    reductionStr = reductionStr.padStart(
      reductionColWidth +
        (reductionPercentage !== 0
          ? COLORS.green.length + COLORS.reset.length
          : 0),
    );
    const originalSizeStr = prettyBytes(originalSize);
    const convertedSizeStr = prettyBytes(convertedSize);
    const sizeChangeStr = `${originalSizeStr} → ${convertedSizeStr}`.padEnd(
      sizeChangeColWidth,
    );
    console.log(`${fileNameStr}  ${reductionStr}  ${sizeChangeStr}`);
    totalOriginalSize += originalSize;
    totalConvertedSize += convertedSize;
  }

  // 合計情報出力
  const totalSavings = totalOriginalSize - totalConvertedSize;
  const totalOriginalSizeStr = prettyBytes(totalOriginalSize);
  const totalConvertedSizeStr = prettyBytes(totalConvertedSize);
  const totalSavingsStr = prettyBytes(Math.abs(totalSavings));
  console.log("");
  console.log(
    `元画像の合計: ${COLORS.cyan}${totalOriginalSizeStr}${COLORS.reset}`,
  );
  console.log(
    `変換後の合計: ${COLORS.cyan}${totalConvertedSizeStr}${COLORS.reset}`,
  );
  if (totalSavings > 0) {
    console.log(
      `削減された合計: ${COLORS.green}${totalSavingsStr}${COLORS.reset}`,
    );
  } else if (totalSavings < 0) {
    console.log(
      `${COLORS.red}増加した合計:${COLORS.reset} ${COLORS.red}${totalSavingsStr}${COLORS.reset}`,
    );
  } else {
    console.log(`削減された合計: 0 B (0%削減)`);
  }
}

// メイン処理
async function main() {
  const {
    buildDir,
    targetExtensions,
    outputFormat,
    formatOptions,
    removeOriginal,
    concurrency,
  } = config;
  console.log("");
  console.log(
    `${COLORS.cyan}[INFO]${COLORS.reset} 画像最適化処理を開始 (出力形式: ${outputFormat})`,
  );
  console.log(
    `${COLORS.cyan}[INFO]${COLORS.reset} ビルドディレクトリ: ${path.resolve(buildDir)}`,
  );
  const images = getImageFiles(buildDir, targetExtensions);
  if (images.length === 0) {
    console.log(
      `${COLORS.yellow}[WARNING]${COLORS.reset} 対象の画像ファイルが見つかりませんでした。処理を終了します。`,
    );
    return;
  }
  const results = await processImagesInBatches(
    images,
    outputFormat,
    formatOptions,
    concurrency,
  );
  printOptimizationResults(results);
  const succeededCount = results.filter((r) => r.success).length;
  const failedCount = results.length - succeededCount;
  console.log("");
  if (failedCount > 0) {
    console.log(`${COLORS.red}[ERROR]${COLORS.reset} 失敗: ${failedCount}件`);
    results
      .filter((r) => !r.success)
      .forEach((r) => {
        console.log(
          `- ${r.original} - ${COLORS.red}${r.error?.message || "不明なエラー"}${COLORS.reset}`,
        );
      });
  }
  if (succeededCount > 0) {
    removeOriginalFiles(results, removeOriginal);
    await replaceImageReferences(buildDir, targetExtensions, outputFormat);
  }
  // 処理時間のみ出力
  const endTime = Date.now();
  const duration = (
    (endTime - (globalThis.__startTime || endTime)) /
    1000
  ).toFixed(2);
  console.log(
    `${COLORS.green}[SUCCESS]${COLORS.reset} 全ての処理が完了しました（処理時間: ${duration}秒）`,
  );
}

// 実行
globalThis.__startTime = Date.now();
main().catch((e) => {
  console.error(
    `${COLORS.red}[ERROR]${COLORS.reset} 予期せぬエラーが発生しました: ${e.message}`,
  );
  process.exit(1);
});
