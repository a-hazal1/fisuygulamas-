import 'dart:typed_data';
import 'package:document_scan/document_scan.dart';

class ScanResultData {
  final Uint8List scannedBytes;
  final Uint8List originalBytes;
  final double confidence;
  const ScanResultData({required this.scannedBytes,required this.originalBytes,required this.confidence});
}
class ReceiptNotDetectedException implements Exception {
  final String message; const ReceiptNotDetectedException(this.message);
  @override String toString()=>message;
}
class ScannerService {
  final DocumentDetector _detector=DocumentDetector();
  final DocumentProcessor _processor=const DocumentProcessor();
  Future<ScanResultData> process({required String path,required Uint8List originalBytes}) async {
    final input=ScanInput.file(path);
    final corners=await _detector.detect(input,sensitivity:DetectionSensitivity.lenient);
    if(corners==null) throw const ReceiptNotDetectedException('Fişin dört kenarı algılanamadı. Dört köşe kadrajda olacak şekilde tekrar çek.');
    final scan=await _processor.crop(input,corners,filter:ScanFilter.enhance,output:ScanOutputFormat.jpegAt(88),maxDimension:2000,background:true);
    if(scan==null||scan.bytes.isEmpty) throw const ReceiptNotDetectedException('Fiş algılandı ancak perspektif düzeltme tamamlanamadı.');
    return ScanResultData(scannedBytes:scan.bytes,originalBytes:originalBytes,confidence:corners.confidence??0.0);
  }
}
