import 'dart:async';
import 'dart:js' as js;
import 'dart:typed_data';

class ScanResultData {
  final Uint8List scannedBytes;
  final Uint8List originalBytes;
  final double confidence;

  const ScanResultData({
    required this.scannedBytes,
    required this.originalBytes,
    required this.confidence,
  });
}

class ReceiptNotDetectedException implements Exception {
  final String message;

  const ReceiptNotDetectedException(this.message);

  @override
  String toString() => message;
}

class ScannerService {
  Future<ScanResultData> process({
    required String path,
    required Uint8List originalBytes,
  }) async {
    final completer = Completer<ScanResultData>();

    Timer? timeoutTimer;

    try {
      final bridge = js.context['receiptScanner'];

      if (bridge == null) {
        throw const ReceiptNotDetectedException(
          'Web tarama bileşeni yüklenemedi.',
        );
      }

      // Sonsuza kadar "Kenarlar algılanıyor"da kalmasın.
      timeoutTimer = Timer(
        const Duration(seconds: 30),
        () {
          if (!completer.isCompleted) {
            completer.completeError(
              const ReceiptNotDetectedException(
                'Web taraması 30 saniye içinde tamamlanamadı.',
              ),
            );
          }
        },
      );

      final ok = js.allowInterop(
        (dynamic raw, dynamic conf) {
          if (completer.isCompleted) {
            return;
          }

          try {
            final len = (raw['length'] as num).toInt();

            final values = <int>[];

            for (var i = 0; i < len; i++) {
              values.add(
                (raw[i] as num).toInt(),
              );
            }

            completer.complete(
              ScanResultData(
                scannedBytes: Uint8List.fromList(values),
                originalBytes: originalBytes,
                confidence: conf is num
                    ? conf.toDouble()
                    : 0.0,
              ),
            );
          } catch (e) {
            completer.completeError(
              ReceiptNotDetectedException(
                'Web tarama çıktısı okunamadı: $e',
              ),
            );
          }
        },
      );

      final err = js.allowInterop(
        (dynamic e) {
          if (completer.isCompleted) {
            return;
          }

          final message =
              e?.toString() ??
              'Bilinmeyen hata';

          completer.completeError(
            ReceiptNotDetectedException(
              message.contains('NO_DOCUMENT')
                  ? 'Fişin dört kenarı algılanamadı.'
                  : 'Web taraması başarısız: $message',
            ),
          );
        },
      );

      bridge.callMethod(
        'scan',
        [
          List<int>.from(originalBytes),
          ok,
          err,
        ],
      );

      return await completer.future;
    } finally {
      timeoutTimer?.cancel();
    }
  }
}
