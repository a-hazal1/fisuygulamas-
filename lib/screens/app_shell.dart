import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';
import '../services/scanner_service.dart';

class AppShell extends StatefulWidget {
  const AppShell({super.key});
  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  final client = Supabase.instance.client;
  int index = 0;
  Map<String, dynamic>? profile;
  List<Map<String, dynamic>> receipts = [];
  List<Map<String, dynamic>> users = [];
  final selected = <String>{};
  bool loading = true;

  bool get isAdmin => profile?['role'] == 'admin';
  bool get isManager => profile?['role'] == 'manager';

  @override
  void initState() { super.initState(); loadAll(); }

  Future<void> loadAll() async {
    setState(() => loading = true);
    try {
      final uid = client.auth.currentUser!.id;
      final p = await client.from('profiles_with_branch').select().eq('id', uid).single();
      final r = await client.from('receipts_with_details').select().order('created_at', ascending: false);
      List<Map<String, dynamic>> u = [];
      if (p['role'] == 'admin') {
        final raw = await client.from('profiles_with_branch').select().order('full_name');
        u = List<Map<String, dynamic>>.from(raw);
      }
      if (!mounted) return;
      setState(() {
        profile = Map<String, dynamic>.from(p);
        receipts = List<Map<String, dynamic>>.from(r);
        users = u;
        loading = false;
      });
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Veriler alınamadı: $e')));
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (profile == null && loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final pages = <Widget>[
      dashboard(), archive(), scanPage(), if (isAdmin) usersPage(),
    ];
    if (index >= pages.length) index = 0;
    final wide = MediaQuery.sizeOf(context).width >= 900;
    if (!wide) {
      return Scaffold(
        appBar: AppBar(title: const Text('FişToplama Pro', style: TextStyle(fontWeight: FontWeight.w900)), actions: [IconButton(onPressed: () => client.auth.signOut(), icon: const Icon(Icons.logout))]),
        body: pages[index],
        bottomNavigationBar: NavigationBar(selectedIndex: index, onDestinationSelected: (i) => setState(() => index = i), destinations: [
          const NavigationDestination(icon: Icon(Icons.dashboard_outlined), label: 'Panel'),
          const NavigationDestination(icon: Icon(Icons.receipt_long_outlined), label: 'Arşiv'),
          const NavigationDestination(icon: Icon(Icons.document_scanner_outlined), label: 'Fiş Tara'),
          if (isAdmin) const NavigationDestination(icon: Icon(Icons.people_outline), label: 'Kullanıcılar'),
        ]),
      );
    }
    return Scaffold(body: Row(children: [
      Container(width: 260, color: const Color(0xFF111827), child: SafeArea(child: Column(children: [
        const Padding(padding: EdgeInsets.all(22), child: Row(children: [Icon(Icons.document_scanner_rounded, color: Colors.white), SizedBox(width: 10), Text('FişToplama Pro', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w900))])),
        menu('Genel Bakış', Icons.dashboard_rounded, 0), menu('Fiş Arşivi', Icons.receipt_long_rounded, 1), menu('Fiş Tara', Icons.document_scanner_rounded, 2),
        if (isAdmin) menu('Kullanıcılar', Icons.people_alt_rounded, 3),
        const Spacer(),
        Padding(padding: const EdgeInsets.all(16), child: ListTile(
          tileColor: Colors.white.withOpacity(.07), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          title: Text(profile?['full_name'] ?? '', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
          subtitle: Text((profile?['role'] ?? '').toString().toUpperCase(), style: const TextStyle(color: Colors.white54)),
          trailing: IconButton(onPressed: () => client.auth.signOut(), icon: const Icon(Icons.logout, color: Colors.white70)),
        )),
      ]))),
      Expanded(child: pages[index]),
    ]));
  }

  Widget menu(String label, IconData icon, int i) => Padding(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4), child: ListTile(
    selected: index == i, selectedTileColor: Colors.white.withOpacity(.11), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    leading: Icon(icon, color: index == i ? Colors.white : Colors.white60), title: Text(label, style: TextStyle(color: index == i ? Colors.white : Colors.white70, fontWeight: FontWeight.w700)),
    onTap: () => setState(() => index = i),
  ));

  Widget dashboard() {
    final now = DateTime.now();
    final today = receipts.where((r) { final d = DateTime.parse(r['created_at']); return d.year == now.year && d.month == now.month && d.day == now.day; }).length;
    return page(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Merhaba, ${profile?['full_name'] ?? ''}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900)),
      const SizedBox(height: 6), Text(profile?['branch_name'] ?? 'Merkezi fiş sistemi', style: const TextStyle(color: Color(0xFF667085))), const SizedBox(height: 22),
      Wrap(spacing: 14, runSpacing: 14, children: [stat('Toplam Fiş', '${receipts.length}', Icons.receipt_long), stat('Bugün Eklenen', '$today', Icons.today), stat('Seçili Fiş', '${selected.length}', Icons.task_alt)]),
      const SizedBox(height: 20),
      Card(child: Padding(padding: const EdgeInsets.all(22), child: Wrap(spacing: 10, runSpacing: 10, children: [
        FilledButton.icon(onPressed: () => setState(() => index = 2), icon: const Icon(Icons.document_scanner), label: const Text('Yeni Fiş Tara')),
        OutlinedButton.icon(onPressed: () => setState(() => index = 1), icon: const Icon(Icons.receipt_long), label: const Text('Arşivi Aç')),
      ]))),
    ]));
  }

  Widget stat(String title, String value, IconData icon) => SizedBox(width: 260, child: Card(child: Padding(padding: const EdgeInsets.all(18), child: Row(children: [
    Container(width: 48, height: 48, decoration: BoxDecoration(color: const Color(0xFFFFF1F0), borderRadius: BorderRadius.circular(14)), child: Icon(icon, color: const Color(0xFFB42318))),
    const SizedBox(width: 14), Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: const TextStyle(color: Color(0xFF667085))), Text(value, style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w900))])
  ]))));

  Widget archive() => page(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Row(children: [const Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Fiş Arşivi', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900)), SizedBox(height: 6), Text('Merkezi arşivden fişleri seç ve 6’lı A4 oluştur.', style: TextStyle(color: Color(0xFF667085)))])), FilledButton.icon(onPressed: selected.isEmpty ? null : buildPdf, icon: const Icon(Icons.picture_as_pdf), label: Text('6’lı PDF (${selected.length})'))]),
    const SizedBox(height: 18),
    if (loading) const LinearProgressIndicator(),
    LayoutBuilder(builder: (_, c) {
      final cols = c.maxWidth > 1100 ? 4 : c.maxWidth > 760 ? 3 : c.maxWidth > 500 ? 2 : 1;
      return GridView.builder(shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), itemCount: receipts.length, gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: cols, crossAxisSpacing: 14, mainAxisSpacing: 14, childAspectRatio: cols == 1 ? 1.15 : .78), itemBuilder: (_, i) {
        final r = receipts[i]; final id = r['id'] as String; final active = selected.contains(id);
        return FutureBuilder<String>(future: client.storage.from('receipts').createSignedUrl(r['storage_path'], 3600), builder: (_, snap) => Card(clipBehavior: Clip.antiAlias, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20), side: BorderSide(color: active ? const Color(0xFFB42318) : const Color(0xFFE4E7EC), width: active ? 2 : 1)), child: InkWell(onTap: () => setState(() => active ? selected.remove(id) : selected.add(id)), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Expanded(child: Stack(fit: StackFit.expand, children: [Container(color: const Color(0xFFF2F4F7), child: snap.hasData ? Image.network(snap.data!, fit: BoxFit.contain) : const Center(child: CircularProgressIndicator())), Positioned(top: 10, left: 10, child: CircleAvatar(radius: 15, backgroundColor: active ? const Color(0xFFB42318) : Colors.white, child: Icon(active ? Icons.check : Icons.add, size: 17, color: active ? Colors.white : const Color(0xFF667085))))])),
          Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(r['branch_name'] ?? 'Şube yok', style: const TextStyle(fontWeight: FontWeight.w900)), Text(r['user_name'] ?? '', style: const TextStyle(fontSize: 12, color: Color(0xFF667085))), Text(DateFormat('dd.MM.yyyy HH:mm').format(DateTime.parse(r['created_at'])), style: const TextStyle(fontSize: 11, color: Color(0xFF98A2B3))), if ((r['note'] ?? '').toString().isNotEmpty) Text(r['note'], maxLines: 1, overflow: TextOverflow.ellipsis)])),
        ]))));
      });
    })
  ]));

  Widget scanPage() => ReceiptScanPanel(profile: profile!, onSaved: () async { await loadAll(); if (mounted) setState(() => index = 1); });

  Widget usersPage() => page(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Row(children: [const Expanded(child: Text('Kullanıcı Yönetimi', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900))), FilledButton.icon(onPressed: createUserDialog, icon: const Icon(Icons.person_add), label: const Text('Kullanıcı Ekle'))]), const SizedBox(height: 18),
    ...users.map((u) => Card(child: ListTile(leading: CircleAvatar(child: Text((u['full_name'] ?? '?').toString().substring(0,1).toUpperCase())), title: Text(u['full_name'] ?? '', style: const TextStyle(fontWeight: FontWeight.w800)), subtitle: Text('${u['email']} • ${(u['role'] ?? '').toString().toUpperCase()} • ${u['branch_name'] ?? 'Şube yok'}'), trailing: Switch(value: u['active'] ?? true, onChanged: u['id'] == profile?['id'] ? null : (v) async { await client.from('profiles').update({'active': v}).eq('id', u['id']); await loadAll(); })))).toList(),
  ]));

  Widget page(Widget child) => SingleChildScrollView(padding: const EdgeInsets.all(28), child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 1280), child: child));

  Future<void> createUserDialog() async {
    final name = TextEditingController(), email = TextEditingController(), pass = TextEditingController(); String role = 'staff';
    final branches = List<Map<String,dynamic>>.from(await client.from('branches').select('id,name').eq('active', true).order('name')); String? branchId;
    if (!mounted) return;
    final ok = await showDialog<bool>(context: context, builder: (ctx) => StatefulBuilder(builder: (ctx, setD) => AlertDialog(title: const Text('Yeni Kullanıcı'), content: SizedBox(width: 440, child: SingleChildScrollView(child: Column(children: [
      TextField(controller: name, decoration: const InputDecoration(labelText: 'Ad Soyad')), const SizedBox(height: 10), TextField(controller: email, decoration: const InputDecoration(labelText: 'E-posta')), const SizedBox(height: 10), TextField(controller: pass, obscureText: true, decoration: const InputDecoration(labelText: 'Geçici Şifre')), const SizedBox(height: 10),
      DropdownButtonFormField<String>(value: role, decoration: const InputDecoration(labelText: 'Rol'), items: const [DropdownMenuItem(value: 'staff', child: Text('Personel')), DropdownMenuItem(value: 'manager', child: Text('Yönetici')), DropdownMenuItem(value: 'admin', child: Text('Admin'))], onChanged: (v) => setD(() => role = v ?? 'staff')), const SizedBox(height: 10),
      DropdownButtonFormField<String?>(value: branchId, decoration: const InputDecoration(labelText: 'Şube'), items: [const DropdownMenuItem<String?>(value: null, child: Text('Şube yok')), ...branches.map((b) => DropdownMenuItem<String?>(value: b['id'], child: Text(b['name'])))], onChanged: (v) => setD(() => branchId = v)),
    ]))), actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Vazgeç')), FilledButton(onPressed: () async { try { final res = await client.functions.invoke('create-user', body: {'email': email.text.trim(), 'password': pass.text, 'full_name': name.text.trim(), 'role': role, 'branch_id': branchId}); if (res.status >= 200 && res.status < 300) { if (ctx.mounted) Navigator.pop(ctx, true); } else { throw Exception(res.data); } } catch (e) { if (ctx.mounted) ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text('Hata: $e'))); } }, child: const Text('Oluştur'))] )));
    if (ok == true) await loadAll();
  }

  Future<void> buildPdf() async {
    final chosen = receipts.where((r) => selected.contains(r['id'])).toList();
    final doc = pw.Document(); const margin = 18.0, gap = 8.0; final w = (PdfPageFormat.a4.width - margin*2 - gap)/2; final h = (PdfPageFormat.a4.height - margin*2 - gap*2)/3;
    final items = <Map<String,dynamic>>[];
    for (final r in chosen) { final bytes = await client.storage.from('receipts').download(r['storage_path']); items.add({'bytes': bytes, 'caption': '${r['branch_name'] ?? ''} • ${r['user_name'] ?? ''}'}); }
    pw.Widget cell(Map<String,dynamic>? x) => x == null ? pw.SizedBox(width:w,height:h) : pw.Container(width:w,height:h,padding:const pw.EdgeInsets.all(6),decoration:pw.BoxDecoration(border:pw.Border.all(color:PdfColors.grey300)),child:pw.Column(children:[pw.Container(height:h-28,alignment:pw.Alignment.center,child:pw.Image(pw.MemoryImage(x['bytes']),fit:pw.BoxFit.contain)),pw.SizedBox(height:4),pw.Text(x['caption'],maxLines:1,style:const pw.TextStyle(fontSize:7))]));
    for (var s=0;s<items.length;s+=6) { final e=(s+6<items.length)?s+6:items.length; final ch=items.sublist(s,e); Map<String,dynamic>? at(int i)=>i<ch.length?ch[i]:null; doc.addPage(pw.Page(pageFormat:PdfPageFormat.a4,margin:const pw.EdgeInsets.all(margin),build:(_)=>pw.Column(children:[pw.Row(children:[cell(at(0)),pw.SizedBox(width:gap),cell(at(1))]),pw.SizedBox(height:gap),pw.Row(children:[cell(at(2)),pw.SizedBox(width:gap),cell(at(3))]),pw.SizedBox(height:gap),pw.Row(children:[cell(at(4)),pw.SizedBox(width:gap),cell(at(5))])]))); }
    await Printing.sharePdf(bytes: await doc.save(), filename: 'fisler_${DateFormat('yyyyMMdd_HHmm').format(DateTime.now())}.pdf');
  }
}

class ReceiptScanPanel extends StatefulWidget {
  final Map<String,dynamic> profile;
  final VoidCallback onSaved;
  const ReceiptScanPanel({super.key, required this.profile, required this.onSaved});
  @override
  State<ReceiptScanPanel> createState()=>_ReceiptScanPanelState();
}

enum ScanItemState { processing, ready, failed }

class ScannedReceiptItem {
  final String id;
  final String fileName;
  final Uint8List originalBytes;
  Uint8List? scannedBytes;
  double confidence;
  ScanItemState state;
  String? error;

  ScannedReceiptItem({
    required this.id,
    required this.fileName,
    required this.originalBytes,
    this.scannedBytes,
    this.confidence=0,
    this.state=ScanItemState.processing,
    this.error,
  });

  bool get isReady => state == ScanItemState.ready && scannedBytes != null;
}

class _ReceiptScanPanelState extends State<ReceiptScanPanel> {
  final picker=ImagePicker();
  final note=TextEditingController();
  final scanner=ScannerService();
  final List<ScannedReceiptItem> scannedItems=[];
  bool saving=false;

  int get readyCount => scannedItems.where((e)=>e.isReady).length;
  bool get processing => scannedItems.any((e)=>e.state==ScanItemState.processing);

  Future<void> pickMultiple() async {
    final files=await picker.pickMultiImage(imageQuality:88,maxWidth:2200);
    if(files.isEmpty)return;
    // Web tarafında tek OpenCV worker kullanıldığı için işleri sırayla yürüt.
    // Mobilde iki fişi paralel işlemek toplam bekleme süresini azaltır ve RAM'i kontrollü tutar.
    if(kIsWeb){
      for(final file in files){
        await addAndProcess(file);
      }
    }else{
      for(var i=0;i<files.length;i+=2){
        await Future.wait(files.skip(i).take(2).map(addAndProcess));
      }
    }
  }

  Future<void> pickCamera() async {
    final file=await picker.pickImage(source:ImageSource.camera,imageQuality:88,maxWidth:2200);
    if(file==null)return;
    await addAndProcess(file);
  }

  Future<void> addAndProcess(XFile file) async {
    final bytes=await file.readAsBytes();
    final item=ScannedReceiptItem(id:const Uuid().v4(),fileName:file.name,originalBytes:bytes);
    setState(()=>scannedItems.insert(0,item));
    try{
      final result=await scanner.process(path:file.path,originalBytes:bytes);
      if(!mounted)return;
      setState((){
        item.scannedBytes=result.scannedBytes;
        item.confidence=result.confidence;
        item.state=ScanItemState.ready;
      });
    } on ReceiptNotDetectedException catch(e){
      if(!mounted)return;
      setState((){item.state=ScanItemState.failed;item.error=e.message;});
    } catch(e){
      if(!mounted)return;
      setState((){item.state=ScanItemState.failed;item.error='Tarama hatası: $e';});
    }
  }

  Future<void> saveAll() async {
    final ready=scannedItems.where((e)=>e.isReady).toList();
    if(ready.isEmpty||saving)return;
    setState(()=>saving=true);
    final c=Supabase.instance.client;
    final uid=widget.profile['id'];
    var saved=0;
    try{
      for(final item in ready){
        final rid=const Uuid().v4();
        final op='$uid/$rid/original.jpg';
        final sp='$uid/$rid/scanned.jpg';
        // Aynı fişin iki görseli birbirinden bağımsız; paralel yüklemek ağ beklemesini azaltır.
        await Future.wait([
          c.storage.from('receipts').uploadBinary(op,item.originalBytes,fileOptions:const FileOptions(contentType:'image/jpeg')),
          c.storage.from('receipts').uploadBinary(sp,item.scannedBytes!,fileOptions:const FileOptions(contentType:'image/jpeg')),
        ]);
        await c.from('receipts').insert({
          'id':rid,'user_id':uid,'branch_id':widget.profile['branch_id'],
          'storage_path':sp,'original_storage_path':op,
          'note':note.text.trim(),'edges_detected':true,
        });
        saved++;
        if(mounted)setState(()=>scannedItems.remove(item));
      }
      if(!mounted)return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('$saved fiş merkezi arşive kaydedildi.')));
      widget.onSaved();
    }catch(e){
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('Toplu kayıt hatası: $e')));
    }finally{
      if(mounted)setState(()=>saving=false);
    }
  }

  void clearAll(){ if(!processing&&!saving)setState(()=>scannedItems.clear()); }
  void removeItem(ScannedReceiptItem x){ if(x.state!=ScanItemState.processing)setState(()=>scannedItems.remove(x)); }

  @override
  void dispose(){ note.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context)=>SingleChildScrollView(
    padding:const EdgeInsets.all(28),
    child:ConstrainedBox(
      constraints:const BoxConstraints(maxWidth:1280),
      child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Wrap(alignment:WrapAlignment.spaceBetween,crossAxisAlignment:WrapCrossAlignment.center,spacing:12,runSpacing:12,children:[
          const Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
            Text('Fiş Tara',style:TextStyle(fontSize:28,fontWeight:FontWeight.w900)),
            SizedBox(height:5),
            Text('Bir veya birden fazla fiş seç; kenarlar otomatik bulunup kırpılır.',style:TextStyle(color:Color(0xFF667085))),
          ]),
          Wrap(spacing:9,runSpacing:9,children:[
            OutlinedButton.icon(onPressed:processing||saving?null:pickMultiple,icon:const Icon(Icons.photo_library_outlined),label:Text(kIsWeb?'Görselleri Seç':'Galeriden Çoklu Seç')),
            if(!kIsWeb) OutlinedButton.icon(onPressed:processing||saving?null:pickCamera,icon:const Icon(Icons.photo_camera),label:const Text('Kamerayla Tara')),
            FilledButton.icon(onPressed:readyCount==0||processing||saving?null:saveAll,icon:const Icon(Icons.cloud_upload_outlined),label:Text(saving?'Kaydediliyor...':'Arşive Ekle ($readyCount)')),
            TextButton.icon(onPressed:scannedItems.isEmpty||processing||saving?null:clearAll,icon:const Icon(Icons.delete_sweep_outlined),label:const Text('Tümünü Temizle')),
          ]),
        ]),
        const SizedBox(height:18),
        Card(child:Padding(padding:const EdgeInsets.all(18),child:Row(children:[
          Expanded(child:TextField(controller:note,decoration:const InputDecoration(labelText:'Açıklama',hintText:'İsteğe bağlı — seçilen fişlerin tümüne uygulanır'))),
          const SizedBox(width:14),
          Chip(label:Text('${scannedItems.length} seçili • $readyCount hazır')),
        ]))),
        const SizedBox(height:18),
        if(scannedItems.isEmpty)
          const Card(child:SizedBox(height:360,child:Center(child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[Icon(Icons.document_scanner_outlined,size:64,color:Color(0xFF98A2B3)),SizedBox(height:12),Text('Henüz fiş seçilmedi',style:TextStyle(fontWeight:FontWeight.w800))]))))
        else LayoutBuilder(builder:(_,c){
          final cols=c.maxWidth>=1100?4:c.maxWidth>=760?3:c.maxWidth>=500?2:1;
          return GridView.builder(shrinkWrap:true,physics:const NeverScrollableScrollPhysics(),itemCount:scannedItems.length,gridDelegate:SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount:cols,crossAxisSpacing:14,mainAxisSpacing:14,childAspectRatio:.72),itemBuilder:(_,i)=>scanCard(scannedItems[i]));
        }),
      ]),
    ),
  );

  Widget scanCard(ScannedReceiptItem item){
    final ready=item.state==ScanItemState.ready;
    final failed=item.state==ScanItemState.failed;
    return Card(clipBehavior:Clip.antiAlias,child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
      Expanded(child:Container(color:const Color(0xFFF2F4F7),child:item.state==ScanItemState.processing
        ? const Center(child:Column(mainAxisSize:MainAxisSize.min,children:[CircularProgressIndicator(),SizedBox(height:12),Text('Kenarlar algılanıyor...')]))
        : ready?Image.memory(item.scannedBytes!,fit:BoxFit.contain):Image.memory(item.originalBytes,fit:BoxFit.contain))),
      Padding(padding:const EdgeInsets.all(12),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Row(children:[Expanded(child:Text(item.fileName,maxLines:1,overflow:TextOverflow.ellipsis,style:const TextStyle(fontWeight:FontWeight.w800))),if(item.state!=ScanItemState.processing)IconButton(visualDensity:VisualDensity.compact,onPressed:()=>removeItem(item),icon:const Icon(Icons.close))]),
        if(ready) Row(children:[const Icon(Icons.check_circle,color:Colors.green,size:18),const SizedBox(width:6),Expanded(child:Text('Otomatik kırpıldı • ${(item.confidence*100).clamp(0,100).toStringAsFixed(0)}%'))]),
        if(failed) Row(crossAxisAlignment:CrossAxisAlignment.start,children:[const Icon(Icons.error_outline,color:Colors.red,size:18),const SizedBox(width:6),Expanded(child:Text(item.error??'Algılanamadı',style:const TextStyle(color:Colors.red,fontSize:12)))]),
      ])),
    ]));
  }
}
