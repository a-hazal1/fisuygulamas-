from __future__ import annotations

import json
import math
from typing import Iterable

import cv2
import numpy as np


class DocumentNotFound(Exception):
    pass


def decode_image(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("INVALID_IMAGE")
    return img


def encode_jpeg(img: np.ndarray, quality: int = 94) -> bytes:
    ok, buf = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("JPEG_ENCODE_FAILED")
    return buf.tobytes()


def order_points(points: Iterable[Iterable[float]]) -> np.ndarray:
    pts = np.asarray(points, np.float32).reshape(4, 2)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).reshape(-1)
    return np.array([
        pts[np.argmin(s)],
        pts[np.argmin(d)],
        pts[np.argmax(s)],
        pts[np.argmax(d)],
    ], np.float32)


def normalized_points(points: np.ndarray, shape) -> list[list[float]]:
    h, w = shape[:2]
    q = order_points(points)
    return [[float(x / max(w - 1, 1)), float(y / max(h - 1, 1))] for x, y in q]


def denormalize_points(points, shape) -> np.ndarray:
    h, w = shape[:2]
    p = np.asarray(points, np.float32).reshape(4, 2)
    p[:, 0] *= max(w - 1, 1)
    p[:, 1] *= max(h - 1, 1)
    return order_points(p)


def _resize_for_detection(img: np.ndarray, max_dim: int = 1200):
    h, w = img.shape[:2]
    s = min(1.0, max_dim / float(max(h, w)))
    if s == 1.0:
        return img.copy(), 1.0
    out = cv2.resize(img, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)
    return out, s


def _angle_score(q: np.ndarray) -> float:
    q = order_points(q)
    vals = []
    for i in range(4):
        a = q[(i - 1) % 4] - q[i]
        b = q[(i + 1) % 4] - q[i]
        den = float(np.linalg.norm(a) * np.linalg.norm(b))
        if den < 1e-6:
            return 0.0
        ang = math.degrees(math.acos(float(np.clip(np.dot(a, b) / den, -1, 1))))
        vals.append(max(0.0, 1.0 - abs(ang - 90.0) / 50.0))
    return float(np.mean(vals))


def _edge_support(gray: np.ndarray, q: np.ndarray) -> float:
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 30, 110)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    q = np.round(order_points(q)).astype(np.int32)
    scores = []
    for i in range(4):
        m = np.zeros_like(gray)
        cv2.line(m, tuple(q[i]), tuple(q[(i + 1) % 4]), 255, 7)
        n = cv2.countNonZero(m)
        if n:
            scores.append(cv2.countNonZero(cv2.bitwise_and(m, edges)) / n)
    return float(np.mean(scores)) if scores else 0.0


def _paper_score(img: np.ndarray, q: np.ndarray) -> float:
    h, w = img.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    cv2.fillConvexPoly(mask, np.round(order_points(q)).astype(np.int32), 255)
    area = cv2.countNonZero(mask)
    if area < 100:
        return 0.0

    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    L = float(cv2.mean(lab[:, :, 0], mask=mask)[0]) / 255.0
    S = float(cv2.mean(hsv[:, :, 1], mask=mask)[0]) / 255.0
    return float(np.clip(0.72 * L + 0.28 * (1.0 - S), 0.0, 1.0))


def _contour_candidates(img: np.ndarray) -> list[tuple[float, np.ndarray, str]]:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    total = float(h * w)
    out = []

    masks = []
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    for lo, hi in ((20, 70), (35, 110), (55, 165)):
        e = cv2.Canny(blur, lo, hi)
        e = cv2.morphologyEx(e, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8), iterations=2)
        masks.append((e, 'edge'))

    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    L, S = lab[:, :, 0], hsv[:, :, 1]
    for lp in (45, 58, 68):
        lthr = np.percentile(L, lp)
        sthr = np.percentile(S, 90)
        m = ((L >= lthr) & (S <= sthr)).astype(np.uint8) * 255
        k = max(7, int(min(h, w) * 0.018))
        if k % 2 == 0:
            k += 1
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8), iterations=2)
        masks.append((m, 'paper'))

    for m, source in masks:
        contours, _ = cv2.findContours(m, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for c in sorted(contours, key=cv2.contourArea, reverse=True)[:50]:
            ca = float(cv2.contourArea(c))
            if ca / total < 0.04:
                continue
            hull = cv2.convexHull(c)
            peri = cv2.arcLength(hull, True)
            candidates = []
            for eps in (0.012, 0.018, 0.025, 0.035, 0.05, 0.07):
                a = cv2.approxPolyDP(hull, eps * peri, True)
                if len(a) == 4 and cv2.isContourConvex(a):
                    candidates.append(a.reshape(4, 2).astype(np.float32))
                    break
            if not candidates:
                rect = cv2.minAreaRect(hull)
                candidates.append(cv2.boxPoints(rect).astype(np.float32))

            q = order_points(candidates[0])
            qa = abs(float(cv2.contourArea(q)))
            frac = qa / total
            if frac < 0.05 or frac > 0.94:
                continue
            rect = cv2.minAreaRect(q)
            rw, rh = rect[1]
            if min(rw, rh) < 35:
                continue
            aspect = max(rw, rh) / max(1.0, min(rw, rh))
            if aspect > 6.5:
                continue

            fill = float(np.clip(ca / max(qa, 1.0), 0, 1))
            angle = _angle_score(q)
            edge = _edge_support(gray, q)
            paper = _paper_score(img, q)
            area_score = float(np.clip(frac / 0.42, 0, 1))

            center = q.mean(axis=0)
            dist = math.hypot(center[0] - w / 2, center[1] - h / 2) / max(1.0, math.hypot(w / 2, h / 2))
            center_score = 1.0 - min(1.0, dist)

            score = (0.24 * area_score + 0.17 * fill + 0.15 * angle + 0.23 * edge + 0.16 * paper + 0.05 * center_score)

            margin = min(q[:, 0].min(), q[:, 1].min(), w - 1 - q[:, 0].max(), h - 1 - q[:, 1].max())
            if frac > 0.78 and margin < min(h, w) * 0.015:
                score -= 0.22

            out.append((float(score), q, source))
    return out


def _snap_one_corner(gray: np.ndarray, point: np.ndarray, radius: int) -> np.ndarray:
    h, w = gray.shape
    x, y = int(round(point[0])), int(round(point[1]))
    x1, x2 = max(0, x - radius), min(w, x + radius + 1)
    y1, y2 = max(0, y - radius), min(h, y + radius + 1)
    patch = gray[y1:y2, x1:x2]
    if patch.size < 100:
        return point

    corners = cv2.goodFeaturesToTrack(
        patch,
        maxCorners=18,
        qualityLevel=0.025,
        minDistance=max(4, radius // 6),
        blockSize=5,
        useHarrisDetector=False,
    )
    if corners is None:
        return point

    sobx = cv2.Sobel(patch, cv2.CV_32F, 1, 0, ksize=3)
    soby = cv2.Sobel(patch, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(sobx, soby)
    best = None
    for c in corners.reshape(-1, 2):
        cx, cy = float(c[0]), float(c[1])
        gx, gy = int(round(cx)), int(round(cy))
        g = float(mag[min(max(gy, 0), mag.shape[0]-1), min(max(gx, 0), mag.shape[1]-1)])
        dx = (x1 + cx) - point[0]
        dy = (y1 + cy) - point[1]
        dist = math.hypot(dx, dy)
        score = g - dist * 1.8
        if best is None or score > best[0]:
            best = (score, np.array([x1 + cx, y1 + cy], np.float32))
    return best[1] if best else point


def refine_corners(img: np.ndarray, q: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    radius = max(12, int(min(gray.shape) * 0.035))
    refined = np.array([_snap_one_corner(gray, p, radius) for p in order_points(q)], np.float32)
    # Only keep refinement when geometry remains plausible.
    if abs(cv2.contourArea(refined)) < abs(cv2.contourArea(order_points(q))) * 0.72:
        return order_points(q)
    return order_points(refined)


def detect_document(img: np.ndarray):
    small, scale = _resize_for_detection(img, 1200)
    candidates = _contour_candidates(small)
    if not candidates:
        h, w = img.shape[:2]
        inset = 0.06
        q = np.array([
            [w * inset, h * inset],
            [w * (1 - inset), h * inset],
            [w * (1 - inset), h * (1 - inset)],
            [w * inset, h * (1 - inset)],
        ], np.float32)
        return q, 0.0, 'manual'

    candidates.sort(key=lambda x: x[0], reverse=True)
    score, q, source = candidates[0]
    q = q / scale
    q = refine_corners(img, q)
    confidence = float(np.clip((score - 0.28) / 0.55, 0.0, 1.0))
    return q, confidence, source


def warp_document(img: np.ndarray, q: np.ndarray) -> np.ndarray:
    tl, tr, br, bl = order_points(q)
    width = int(round(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))))
    height = int(round(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))))
    if min(width, height) < 80:
        raise DocumentNotFound('NO_DOCUMENT')
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], np.float32)
    M = cv2.getPerspectiveTransform(np.array([tl, tr, br, bl], np.float32), dst)
    out = cv2.warpPerspective(img, M, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    if out.shape[1] > out.shape[0]:
        out = cv2.rotate(out, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return out


def _scanner_look(img: np.ndarray) -> np.ndarray:
    """
    Gerçek taranmış belge görünümü:
    - gölge/aydınlatma farkını düzeltir
    - kağıdı beyaza yaklaştırır
    - yazıyı koyulaştırır
    - termal fişte detayları tamamen öldürmez
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Gürültüyü çok hafif azalt.
    gray = cv2.bilateralFilter(gray, 5, 18, 18)

    # Büyük ölçekli aydınlatma/gölge haritası.
    h, w = gray.shape
    sigma = max(25.0, min(h, w) * 0.055)
    background = cv2.GaussianBlur(
        gray,
        (0, 0),
        sigmaX=sigma,
        sigmaY=sigma,
    )

    # Gölgeyi kaldır. Ortalama kağıt tonu beyaza yaklaşır.
    norm = cv2.divide(
        gray,
        np.maximum(background, 1),
        scale=238,
    )

    # Uç değerler yerine yüzdeliklerle kontrastı aç.
    lo = float(np.percentile(norm, 2.0))
    hi = float(np.percentile(norm, 98.8))
    if hi - lo > 8:
        norm = np.clip((norm.astype(np.float32) - lo) * (255.0 / (hi - lo)), 0, 255).astype(np.uint8)

    # Yazıyı belirginleştir ama adaptiveThreshold gibi koparma yapma.
    clahe = cv2.createCLAHE(clipLimit=1.65, tileGridSize=(8, 8))
    enhanced = clahe.apply(norm)

    # Beyaz kağıdı biraz daha temizle, koyu yazıyı koru.
    lut = np.arange(256, dtype=np.float32)
    lut = np.where(lut >= 170, lut + (255 - lut) * 0.34, lut)
    lut = np.where(lut <= 115, lut * 0.88, lut)
    lut = np.clip(lut, 0, 255).astype(np.uint8)
    enhanced = cv2.LUT(enhanced, lut)

    # Çok hafif unsharp mask.
    blur = cv2.GaussianBlur(enhanced, (0, 0), 0.8)
    enhanced = cv2.addWeighted(enhanced, 1.16, blur, -0.16, 0)

    return cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)



def trim_background_after_warp(img: np.ndarray) -> np.ndarray:
    """
    Perspective sonrasında fişin sağ/solunda kalan klavye, masa veya koyu
    zemin şeritlerini güvenli biçimde temizler. Merkezdeki kağıt tonunu
    referans alır; emin değilse görüntüye dokunmaz.
    """
    if img is None or img.size == 0:
        return img

    h, w = img.shape[:2]
    if h < 180 or w < 120:
        return img

    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    L = lab[:, :, 0]
    y1, y2 = int(h * 0.08), int(h * 0.92)
    core = L[y1:y2]
    if core.size == 0:
        return img

    # Yazıdan etkilenmemek için her sütunun yüksek yüzdelik parlaklığı.
    col_light = np.percentile(core, 72, axis=0)
    center = col_light[int(w * 0.34):int(w * 0.66)]
    if center.size == 0:
        return img
    paper_level = float(np.median(center))
    threshold = max(105.0, paper_level - 34.0)

    # 7 px pencere ile koyu dış bantları ara.
    win = max(5, int(w * 0.018))
    left = 0
    for x in range(0, int(w * 0.30)):
        seg = col_light[x:min(w, x + win)]
        if len(seg) and np.median(seg) >= threshold:
            left = x
            break

    right = w
    for x in range(w - 1, int(w * 0.70), -1):
        seg = col_light[max(0, x - win + 1):x + 1]
        if len(seg) and np.median(seg) >= threshold:
            right = x + 1
            break

    # Küçük güvenlik payı: kağıt kenarını kesme.
    pad = max(4, int(w * 0.014))
    left = max(0, left - pad)
    right = min(w, right + pad)

    new_w = right - left
    removed = w - new_w
    # Yalnızca anlamlı fakat aşırı olmayan kesimlerde uygula.
    if new_w < w * 0.58 or removed < w * 0.025 or removed > w * 0.35:
        return img

    return img[:, left:right].copy()

def enhance_document(img: np.ndarray, mode: str = 'scan') -> np.ndarray:
    mode = (mode or 'scan').lower()
    if mode == 'original':
        out = img
    elif mode == 'gray':
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=1.35, tileGridSize=(8, 8))
        out = cv2.cvtColor(clahe.apply(g), cv2.COLOR_GRAY2BGR)
    elif mode == 'bw':
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        g = cv2.GaussianBlur(g, (3, 3), 0)
        bw = cv2.adaptiveThreshold(g, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 12)
        out = cv2.cvtColor(bw, cv2.COLOR_GRAY2BGR)
    elif mode == 'color':
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=1.12, tileGridSize=(8, 8))
        l2 = clahe.apply(l)
        l = cv2.addWeighted(l, 0.82, l2, 0.18, 0)
        out = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
    else:
        out = _scanner_look(img)

    h, w = out.shape[:2]
    if max(h, w) > 2600:
        s = 2600.0 / max(h, w)
        out = cv2.resize(out, (max(1, round(w*s)), max(1, round(h*s))), interpolation=cv2.INTER_AREA)
    return out


def detect_from_bytes(data: bytes):
    img = decode_image(data)
    q, confidence, source = detect_document(img)
    h, w = img.shape[:2]
    return {
        'corners': normalized_points(q, img.shape),
        'confidence': confidence,
        'method': source,
        'width': w,
        'height': h,
        'needsReview': confidence < 0.58,
    }


def warp_from_bytes(data: bytes, corners, mode: str = 'scan') -> bytes:
    img = decode_image(data)
    q = denormalize_points(corners, img.shape)
    # /detect zaten köşeleri refine etti. Burada ikinci kez refine etmek
    # özellikle klavye üstündeki yatay fişin köşelerini tekrar kaydırıyordu.
    # Kullanıcının elle düzelttiği köşelere de asla dokunmuyoruz.
    out = warp_document(img, q)
    out = trim_background_after_warp(out)
    out = enhance_document(out, mode)
    return encode_jpeg(out)


def scan_image(data: bytes):
    img = decode_image(data)
    q, confidence, _ = detect_document(img)
    out = warp_document(img, q)
    out = trim_background_after_warp(out)
    out = enhance_document(out, 'scan')
    return encode_jpeg(out), float(confidence)
