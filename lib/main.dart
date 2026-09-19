import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'screens/app_shell.dart';
import 'screens/login_page.dart';
Future<void> main() async {WidgetsFlutterBinding.ensureInitialized();const url=String.fromEnvironment('SUPABASE_URL'),key=String.fromEnvironment('SUPABASE_ANON_KEY');if(url.isEmpty||key.isEmpty){runApp(const MaterialApp(home:Scaffold(body:Center(child:Text('Supabase ayarları eksik.')))));return;}await Supabase.initialize(url:url,anonKey:key);runApp(const App());}
class App extends StatelessWidget{const App({super.key});@override Widget build(BuildContext c)=>MaterialApp(debugShowCheckedModeBanner:false,title:'FişToplama Pro',theme:ThemeData(useMaterial3:true,scaffoldBackgroundColor:const Color(0xFFF8F9FC),colorScheme:ColorScheme.fromSeed(seedColor:const Color(0xFFA14F43))),home:const Gate());}
class Gate extends StatelessWidget{const Gate({super.key});@override Widget build(BuildContext c)=>StreamBuilder<AuthState>(stream:Supabase.instance.client.auth.onAuthStateChange,builder:(_,__)=>Supabase.instance.client.auth.currentSession==null?const LoginPage():const AppShell());}
