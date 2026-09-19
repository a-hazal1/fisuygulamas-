'use strict';

let cvReadyPromise = null;

function safeDelete(...items) {
  for (const item of items) {
    try {
      if (item && typeof item.delete === 'function') item.delete();
    } catch (_) {}
  }
}

async function getCv() {
  if (cvReadyPromise) return cvReadyPromise;

  cvReadyPromise = (async () => {
    importScripts('opencv.js');

    const started = Date.now();
    while (Date.now() - started < 30000) {
      let candidate = self.cv;

      if (candidate && typeof candidate.then === 'function') {
        try {
          candidate = await candidate;
          self.cv = candidate;
        } catch (_) {}
      }

      if (candidate && typeof candidate.Mat === 'function') {
        return candidate;
      }

      await new Promise(r => setTimeout(r, 50));
    }

    throw new Error('OPENCV_RUNTIME_TIMEOUT');
  })();

  try {
    return await cvReadyPromise;
  } catch (e) {
    cvReadyPromise = null;
    throw e;
  }
}

function setMaskRect(mask, x1, y1, x2, y2, value) {
  const sx = Math.max(0, Math.min(mask.cols, Math.floor(x1)));
  const sy = Math.max(0, Math.min(mask.rows, Math.floor(y1)));
  const ex = Math.max(0, Math.min(mask.cols, Math.ceil(x2)));
  const ey = Math.max(0, Math.min(mask.rows, Math.ceil(y2)));

  for (let y = sy; y < ey; y++) {
    const row = mask.ucharPtr(y);
    for (let x = sx; x < ex; x++) row[x] = value;
  }
}

function resizeForAnalysis(cv, src, maxSide = 420) {
  const maxDim = Math.max(src.cols, src.rows);
  const scale = Math.min(1.0, maxSide / maxDim);

  if (scale >= 1.0) return { mat: src.clone(), scale: 1.0 };

  const dst = new cv.Mat();
  cv.resize(
    src,
    dst,
    new cv.Size(
      Math.max(1, Math.round(src.cols * scale)),
      Math.max(1, Math.round(src.rows * scale))
    ),
    0,
    0,
    cv.INTER_AREA
  );

  return { mat: dst, scale };
}


function edgeBinaryMask(cv, image) {
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const closed = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
  try {
    if (image.channels() === 4) cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY);
    else if (image.channels() === 3) cv.cvtColor(image, gray, cv.COLOR_RGB2GRAY);
    else image.copyTo(gray);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, 45, 135);
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);
    cv.dilate(closed, closed, kernel, new cv.Point(-1, -1), 1);
    return closed.clone();
  } finally {
    safeDelete(gray, blurred, edges, closed, kernel);
  }
}

function grabCutBinaryMask(cv, image) {
  const GC_BGD = 0;
  const GC_FGD = 1;
  const GC_PR_BGD = 2;
  const GC_PR_FGD = 3;

  const mask = new cv.Mat(
    image.rows,
    image.cols,
    cv.CV_8UC1,
    new cv.Scalar(GC_PR_BGD)
  );

  const border = Math.max(2, Math.round(Math.min(image.rows, image.cols) * 0.025));

  setMaskRect(mask, 0, 0, image.cols, border, GC_BGD);
  setMaskRect(mask, 0, image.rows - border, image.cols, image.rows, GC_BGD);
  setMaskRect(mask, 0, 0, border, image.rows, GC_BGD);
  setMaskRect(mask, image.cols - border, 0, image.cols, image.rows, GC_BGD);

  // Python sürümündeki merkez probable-foreground bölgesi.
  setMaskRect(
    mask,
    image.cols * 0.18,
    image.rows * 0.12,
    image.cols * 0.82,
    image.rows * 0.88,
    GC_PR_FGD
  );

  const bgModel = new cv.Mat();
  const fgModel = new cv.Mat();

  try {
    cv.grabCut(
      image,
      mask,
      new cv.Rect(0, 0, 1, 1),
      bgModel,
      fgModel,
      1,
      cv.GC_INIT_WITH_MASK
    );

    const binary = cv.Mat.zeros(mask.rows, mask.cols, cv.CV_8UC1);

    for (let y = 0; y < mask.rows; y++) {
      const srcRow = mask.ucharPtr(y);
      const dstRow = binary.ucharPtr(y);
      for (let x = 0; x < mask.cols; x++) {
        const v = srcRow[x];
        dstRow[x] = (v === GC_FGD || v === GC_PR_FGD) ? 255 : 0;
      }
    }

    return binary;
  } finally {
    safeDelete(mask, bgModel, fgModel);
  }
}

function morphClean(cv, mask) {
  const closed = new cv.Mat();
  const opened = new cv.Mat();
  const closeKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(11, 11));
  const openKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));

  try {
    cv.morphologyEx(mask, closed, cv.MORPH_CLOSE, closeKernel, new cv.Point(-1, -1), 2);
    cv.morphologyEx(closed, opened, cv.MORPH_OPEN, openKernel, new cv.Point(-1, -1), 1);
    return opened.clone();
  } finally {
    safeDelete(closed, opened, closeKernel, openKernel);
  }
}

function selectLargestCentralContour(cv, mask) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const imageArea = mask.cols * mask.rows;
  const centerX = mask.cols / 2;
  const centerY = mask.rows / 2;
  const maxDistance = Math.hypot(centerX, centerY);

  try {
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    if (contours.size() === 0) throw new Error('NO_DOCUMENT');

    let bestIndex = -1;
    let bestScore = -1e9;

    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      try {
        const area = Math.abs(cv.contourArea(c, false));
        const ratio = area / imageArea;
        if (ratio < 0.03) continue;

        const rect = cv.boundingRect(c);
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const centerScore = 1 - Math.min(1, Math.hypot(cx - centerX, cy - centerY) / maxDistance);

        let touches = 0;
        if (rect.x <= 1) touches++;
        if (rect.y <= 1) touches++;
        if (rect.x + rect.width >= mask.cols - 1) touches++;
        if (rect.y + rect.height >= mask.rows - 1) touches++;

        const score = ratio * 4.0 + centerScore * 1.25 - touches * 0.30;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      } finally {
        c.delete();
      }
    }

    if (bestIndex < 0) throw new Error('NO_DOCUMENT');
    return contours.get(bestIndex);
  } finally {
    hierarchy.delete();
    // contours burada silinemez; seçilen Mat dışarı döndürülüyor.
    // MatVector delete sonrası get() ile alınan Mat bağımsız handle olduğu için güvenlidir.
    contours.delete();
  }
}

function contourPoints(mat) {
  const out = [];
  for (let i = 0; i < mat.rows; i++) {
    const p = mat.intPtr(i, 0);
    out.push([Number(p[0]), Number(p[1])]);
  }
  return out;
}

function boxPointsFromRotatedRect(rect) {
  const angle = rect.angle * Math.PI / 180.0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const hw = rect.size.width / 2.0;
  const hh = rect.size.height / 2.0;
  const local = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];

  return local.map(([x, y]) => [
    rect.center.x + x * cos - y * sin,
    rect.center.y + x * sin + y * cos,
  ]);
}

function contourToQuad(cv, contour, imageArea) {
  const area = Math.abs(cv.contourArea(contour, false));
  if (area / imageArea < 0.08) throw new Error('NO_DOCUMENT');

  const hull = new cv.Mat();
  try {
    cv.convexHull(contour, hull, false, true);
    const perimeter = cv.arcLength(hull, true);
    const eps = [0.010,0.0125,0.015,0.0175,0.020,0.025,0.030,0.040,0.050];

    for (const e of eps) {
      const approx = new cv.Mat();
      try {
        cv.approxPolyDP(hull, approx, e * perimeter, true);
        if (approx.rows === 4 && Math.abs(cv.contourArea(approx, false)) / imageArea >= 0.08) {
          return contourPoints(approx);
        }
      } finally {
        approx.delete();
      }
    }

    return boxPointsFromRotatedRect(cv.minAreaRect(hull));
  } finally {
    hull.delete();
  }
}

function orderPoints(points) {
  const sums = points.map(p => p[0] + p[1]);
  const diffs = points.map(p => p[0] - p[1]);
  return [
    points[sums.indexOf(Math.min(...sums))],
    points[diffs.indexOf(Math.max(...diffs))],
    points[sums.indexOf(Math.max(...sums))],
    points[diffs.indexOf(Math.min(...diffs))],
  ];
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function perspective(cv, original, quadSmall, scale) {
  const quad = quadSmall.map(p => [
    Math.max(0, Math.min(original.cols - 1, p[0] / scale)),
    Math.max(0, Math.min(original.rows - 1, p[1] / scale)),
  ]);

  const [tl, tr, br, bl] = orderPoints(quad);
  const maxWidth = Math.max(2, Math.round(Math.max(distance(br, bl), distance(tr, tl))));
  const maxHeight = Math.max(2, Math.round(Math.max(distance(tr, br), distance(tl, bl))));

  const src = cv.matFromArray(4, 1, cv.CV_32FC2, [tl[0],tl[1], tr[0],tr[1], br[0],br[1], bl[0],bl[1]]);
  const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [0,0, maxWidth-1,0, maxWidth-1,maxHeight-1, 0,maxHeight-1]);
  const matrix = cv.getPerspectiveTransform(src, dst);
  const out = new cv.Mat();

  try {
    cv.warpPerspective(original, out, matrix, new cv.Size(maxWidth, maxHeight), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
    return out.clone();
  } finally {
    safeDelete(src, dst, matrix, out);
  }
}

function enhance(cv, input) {
  let working = input;
  let rotated = null;
  const gray = new cv.Mat();

  try {
    if (input.cols > input.rows * 1.25) {
      rotated = new cv.Mat();
      cv.rotate(input, rotated, cv.ROTATE_90_CLOCKWISE);
      working = rotated;
    }

    if (working.channels() === 4) cv.cvtColor(working, gray, cv.COLOR_RGBA2GRAY);
    else if (working.channels() === 3) cv.cvtColor(working, gray, cv.COLOR_RGB2GRAY);
    else working.copyTo(gray);

    // CLAHE API farklı OpenCV.js derlemelerinde değişebiliyor.
    // Varsa kullan; yoksa normalize edilmiş grayscale'i döndür.
    if (typeof cv.createCLAHE === 'function') {
      const clahe = cv.createCLAHE(1.7, new cv.Size(8, 8));
      const out = new cv.Mat();
      try {
        clahe.apply(gray, out);
        return out.clone();
      } finally {
        safeDelete(clahe, out);
      }
    }

    return gray.clone();
  } finally {
    safeDelete(rotated, gray);
  }
}

async function matToJpegArrayBuffer(cv, mat) {
  const rgba = new cv.Mat();
  try {
    if (mat.channels() === 1) cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA);
    else if (mat.channels() === 3) cv.cvtColor(mat, rgba, cv.COLOR_RGB2RGBA);
    else mat.copyTo(rgba);

    const data = new Uint8ClampedArray(rgba.data);
    const imageData = new ImageData(data, rgba.cols, rgba.rows);
    const canvas = new OffscreenCanvas(rgba.cols, rgba.rows);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
    return await blob.arrayBuffer();
  } finally {
    rgba.delete();
  }
}

async function decodeToMat(cv, buffer) {
  const blob = new Blob([buffer]);
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return cv.matFromImageData(data);
}

self.onmessage = async function (event) {
  const msg = event.data || {};
  const id = msg.id;

  let rgba = null;
  let rgb = null;
  let small = null;
  let mask = null;
  let clean = null;
  let contour = null;
  let warped = null;
  let enhanced = null;

  try {
    const cv = await getCv();
    rgba = await decodeToMat(cv, msg.buffer);
    rgb = new cv.Mat();
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);

    const resized = resizeForAnalysis(cv, rgb, 640);
    small = resized.mat;

    // Hızlı yol: önce Canny + morfoloji ile fiş kenarlarını ara.
    // Bu başarısız olursa daha pahalı GrabCut'a geri düş.
    let quad;
    try {
      mask = edgeBinaryMask(cv, small);
      clean = morphClean(cv, mask);
      contour = selectLargestCentralContour(cv, clean);
      quad = contourToQuad(cv, contour, clean.cols * clean.rows);
    } catch (_) {
      safeDelete(mask, clean, contour);
      mask = clean = contour = null;
      mask = grabCutBinaryMask(cv, small);
      clean = morphClean(cv, mask);
      contour = selectLargestCentralContour(cv, clean);
      quad = contourToQuad(cv, contour, clean.cols * clean.rows);
    }

    warped = perspective(cv, rgb, quad, resized.scale);
    enhanced = enhance(cv, warped);

    const output = await matToJpegArrayBuffer(cv, enhanced);
    self.postMessage(
      { id: id, ok: true, buffer: output, confidence: 1.0 },
      [output]
    );
  } catch (e) {
    self.postMessage({
      id: id,
      ok: false,
      error: e && e.message ? e.message : String(e),
    });
  } finally {
    safeDelete(rgba, rgb, small, mask, clean, contour, warped, enhanced);
  }
};
