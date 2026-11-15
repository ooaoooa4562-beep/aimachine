package com.aimachine.school;

import android.app.Activity;
import android.os.Bundle;
import android.content.SharedPreferences;
import android.content.*;
import android.app.DownloadManager;
import android.net.Uri;
import android.os.Environment;
import android.speech.RecognizerIntent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.*;
import org.json.JSONArray;
import org.json.JSONObject;
import com.chaquo.python.Python;
import com.chaquo.python.PyObject;
import java.util.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
  final int ink=Color.rgb(25,35,53), muted=Color.rgb(116,128,145), blue=Color.rgb(76,105,255), bg=Color.rgb(246,248,252);
  LinearLayout root, messages; EditText input; int grade=7, REQUEST_VOICE_INPUT=73; String model="Helio Gen 1 Flash", chatId="";
  SharedPreferences prefs; ArrayList<JSONObject> chats=new ArrayList<>(); JSONArray current=new JSONArray(); ScrollView scroller;
  final ExecutorService mathExecutor=Executors.newSingleThreadExecutor();
  public void onCreate(Bundle b){super.onCreate(b);prefs=getSharedPreferences("helio_chats",0);loadChats();newChat(false);render();
    registerReceiver(downloadReceiver,new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),Context.RECEIVER_NOT_EXPORTED);
    checkForUpdate();
  }
  @Override protected void onResume(){super.onResume();String pending=prefs.getString("pending_update_url","");if(!pending.isEmpty()&&getPackageManager().canRequestPackageInstalls()){prefs.edit().remove("pending_update_url").apply();downloadUpdate(pending);}}
  @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){super.onActivityResult(requestCode,resultCode,data);if(requestCode!=REQUEST_VOICE_INPUT||resultCode!=RESULT_OK||data==null)return;ArrayList<String> results=data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);if(results==null||results.isEmpty())return;String recognized=results.get(0).trim();if(recognized.isEmpty())return;String existing=input.getText().toString().trim();input.setText(existing.isEmpty()?recognized:existing+" "+recognized);input.setSelection(input.getText().length());}
  final BroadcastReceiver downloadReceiver=new BroadcastReceiver(){public void onReceive(Context c,Intent i){long id=i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID,-1);if(id!=prefs.getLong("update_download_id",-2))return;DownloadManager dm=(DownloadManager)getSystemService(DOWNLOAD_SERVICE);Uri uri=dm.getUriForDownloadedFile(id);if(uri==null){Toast.makeText(MainActivity.this,"Не удалось скачать обновление",Toast.LENGTH_LONG).show();return;}try{Intent install=new Intent(Intent.ACTION_VIEW);install.setDataAndType(uri,"application/vnd.android.package-archive");install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_ACTIVITY_NEW_TASK);startActivity(install);}catch(Exception e){Toast.makeText(MainActivity.this,"Скачивание завершено. Открой файл APK из уведомления загрузок.",Toast.LENGTH_LONG).show();}}};
  void checkForUpdate(){new Thread(()->{HttpURLConnection conn=null;try{conn=(HttpURLConnection)new URL("https://api.github.com/repos/ooaoooa4562-beep/aimachine/releases/latest").openConnection();conn.setConnectTimeout(8000);conn.setReadTimeout(8000);conn.setRequestProperty("Accept","application/vnd.github+json");if(conn.getResponseCode()!=200)return;java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();byte[] buf=new byte[2048];int n;while((n=conn.getInputStream().read(buf))>0)out.write(buf,0,n);JSONObject release=new JSONObject(out.toString("UTF-8"));String tag=release.optString("tag_name");int remote=Integer.parseInt(tag.replaceAll("\\D",""));int local=getPackageManager().getPackageInfo(getPackageName(),0).versionCode;if(remote<=local)return;JSONArray assets=release.optJSONArray("assets");if(assets==null)return;String apk="";for(int i=0;i<assets.length();i++){JSONObject a=assets.getJSONObject(i);if(a.optString("name").endsWith(".apk")){apk=a.optString("browser_download_url");break;}}if(apk.isEmpty())return;String url=apk;runOnUiThread(()->new android.app.AlertDialog.Builder(this).setTitle("Доступно обновление").setMessage("Вышла новая версия Helio. Скачать и установить?").setPositiveButton("Обновить",(d,w)->prepareUpdate(url)).setNegativeButton("Позже",null).show());}catch(Exception ignored){}finally{if(conn!=null)conn.disconnect();}}).start();}
  void prepareUpdate(String url){if(!getPackageManager().canRequestPackageInstalls()){prefs.edit().putString("pending_update_url",url).apply();new android.app.AlertDialog.Builder(this).setTitle("Разреши установку обновлений").setMessage("Android просит разрешить установку приложений, скачанных этим приложением. После разрешения вернись сюда — загрузка начнётся автоматически.").setPositiveButton("Настройки",(d,w)->{Intent i=new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName()));startActivity(i);}).setNegativeButton("Отмена",(d,w)->prefs.edit().remove("pending_update_url").apply()).show();return;}downloadUpdate(url);}
  void downloadUpdate(String url){try{DownloadManager dm=(DownloadManager)getSystemService(DOWNLOAD_SERVICE);DownloadManager.Request req=new DownloadManager.Request(Uri.parse(url));req.setTitle("Обновление Helio");req.setDescription("Скачивание новой версии");req.setMimeType("application/vnd.android.package-archive");req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);req.setDestinationInExternalFilesDir(this,Environment.DIRECTORY_DOWNLOADS,"helio-update.apk");long id=dm.enqueue(req);prefs.edit().putLong("update_download_id",id).apply();Toast.makeText(this,"Скачиваю обновление…",Toast.LENGTH_LONG).show();}catch(Exception e){Toast.makeText(this,"Не удалось начать загрузку обновления",Toast.LENGTH_LONG).show();}}
  void render(){
    getWindow().setStatusBarColor(bg);getWindow().setNavigationBarColor(Color.WHITE);getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
    root=new LinearLayout(this);root.setOrientation(1);root.setBackgroundColor(bg);setContentView(root);

    LinearLayout top=new LinearLayout(this);top.setPadding(12,9,12,9);top.setGravity(Gravity.CENTER_VERTICAL);top.setBackgroundColor(Color.WHITE);top.setElevation(2);root.addView(top);
    TextView history=label("☰",22,ink,true);history.setGravity(Gravity.CENTER);history.setContentDescription("Открыть историю чатов");history.setBackground(round(bg,14));LinearLayout.LayoutParams hp=new LinearLayout.LayoutParams(42,42);hp.rightMargin=8;top.addView(history,hp);history.setOnClickListener(v->showHistory());
    TextView title=label("Helio",20,ink,true);top.addView(title,new LinearLayout.LayoutParams(0,-2,1));
    TextView mode=label(model.equals("Helio Gen 1 Flash")?"⚡ Flash⌄":"✦ Pro⌄",13,blue,true);mode.setGravity(Gravity.CENTER);mode.setMinHeight(40);mode.setPadding(11,8,11,8);mode.setContentDescription("Выбрать режим объяснения");mode.setBackground(round(Color.rgb(239,242,255),18));top.addView(mode);mode.setOnClickListener(v->chooseModel(mode));
    TextView gradeBtn=label(grade+" класс⌄",13,ink,true);gradeBtn.setGravity(Gravity.CENTER);gradeBtn.setMinHeight(40);gradeBtn.setPadding(10,8,9,8);gradeBtn.setContentDescription("Выбрать класс");gradeBtn.setBackground(round(bg,14));LinearLayout.LayoutParams gp=new LinearLayout.LayoutParams(-2,-2);gp.leftMargin=5;top.addView(gradeBtn,gp);gradeBtn.setOnClickListener(v->chooseGrade(gradeBtn));
    TextView fresh=label("＋",25,blue,true);fresh.setGravity(Gravity.CENTER);fresh.setContentDescription("Создать новый чат");fresh.setBackground(round(Color.rgb(239,242,255),14));LinearLayout.LayoutParams fp=new LinearLayout.LayoutParams(42,42);fp.leftMargin=5;top.addView(fresh,fp);fresh.setOnClickListener(v->newChat(true));

    scroller=new ScrollView(this);scroller.setFillViewport(true);root.addView(scroller,new LinearLayout.LayoutParams(-1,0,1));messages=new LinearLayout(this);messages.setPadding(16,16,16,12);messages.setOrientation(1);scroller.addView(messages);
    if(current.length()==0){
      TextView hello=label("Привет! Я Helio",24,ink,true);hello.setGravity(Gravity.CENTER);hello.setPadding(14,18,14,4);messages.addView(hello);
      TextView description=label("Напиши вопрос или надиктуй его. Помогу с математикой и школьными темами.",15,muted,false);description.setGravity(Gravity.CENTER);description.setPadding(16,0,16,18);messages.addView(description);
      TextView cap=label("ПОПРОБУЙ",11,muted,true);cap.setPadding(2,8,0,9);messages.addView(cap);
      for(String s:new String[]{"Реши 3x + 5 = 20","Вычисли (12 + 8) / 4","Площадь круга, радиус 5"}){
        TextView c=label(s+"   →",14,ink,false);c.setPadding(14,13,14,13);c.setBackground(round(Color.WHITE,16));c.setContentDescription(s);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.bottomMargin=8;messages.addView(c,lp);c.setOnClickListener(v->{input.setText(s);send();});
      }
    }else{
      for(int i=0;i<current.length();i++){JSONObject m=current.optJSONObject(i);if(m!=null)addBubble(m.optString("text"),m.optBoolean("user"),false);}
    }

    LinearLayout composer=new LinearLayout(this);composer.setPadding(12,9,12,12);composer.setGravity(Gravity.CENTER_VERTICAL);composer.setBackgroundColor(Color.WHITE);composer.setElevation(8);root.addView(composer);
    input=new EditText(this);input.setSingleLine(false);input.setMinLines(1);input.setMaxLines(4);input.setMinHeight(46);input.setHint("Напиши или надиктуй сообщение…");input.setTextSize(15);input.setPadding(14,10,10,10);input.setBackground(round(bg,17));input.setContentDescription("Текст сообщения");composer.addView(input,new LinearLayout.LayoutParams(0,-2,1));
    TextView voice=label("🎙",19,muted,true);voice.setGravity(Gravity.CENTER);voice.setContentDescription("Надиктовать сообщение");voice.setBackground(round(bg,15));LinearLayout.LayoutParams vp=new LinearLayout.LayoutParams(46,46);vp.leftMargin=7;composer.addView(voice,vp);voice.setOnClickListener(v->startVoiceInput());
    TextView send=label("➤",20,Color.WHITE,true);send.setGravity(Gravity.CENTER);send.setContentDescription("Отправить сообщение");send.setBackground(round(blue,15));LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(46,46);sp.leftMargin=7;composer.addView(send,sp);send.setOnClickListener(v->send());
  }
  void chooseModel(TextView button){new android.app.AlertDialog.Builder(this).setTitle("Режим помощника").setItems(new String[]{"Helio Gen 1 Flash — быстрее","Helio Gen 1 Pro — подробные объяснения"},(d,w)->{model=w==0?"Helio Gen 1 Flash":"Helio Gen 1 Pro";button.setText(w==0?"⚡ Flash⌄":"✦ Pro⌄");}).show();}
  void chooseGrade(TextView button){String[] a=new String[11];for(int i=0;i<11;i++)a[i]=(i+1)+" класс";new android.app.AlertDialog.Builder(this).setTitle("Выбери класс").setItems(a,(d,w)->{grade=w+1;button.setText(grade+" класс⌄");}).show();}
  void send(){String q=input.getText().toString().trim();if(q.isEmpty())return;input.setText("");addBubble(q,true,true);saveChats();scroller.post(()->scroller.fullScroll(View.FOCUS_DOWN));mathExecutor.execute(()->{String answer=solve(q);runOnUiThread(()->{addBubble(answer,false,true);saveChats();scroller.post(()->scroller.fullScroll(View.FOCUS_DOWN));});});}
  void addBubble(String s,boolean user,boolean persist){
    LinearLayout row=new LinearLayout(this);row.setOrientation(LinearLayout.HORIZONTAL);row.setGravity(user?Gravity.END:Gravity.START);LinearLayout.LayoutParams rowParams=new LinearLayout.LayoutParams(-1,-2);rowParams.topMargin=10;messages.addView(row,rowParams);
    if(!user){TextView avatar=label("✦",14,blue,true);avatar.setGravity(Gravity.CENTER);avatar.setBackground(round(Color.rgb(235,239,255),13));LinearLayout.LayoutParams avp=new LinearLayout.LayoutParams(30,30);avp.rightMargin=7;row.addView(avatar,avp);}
    TextView t=label(s,15,user?Color.WHITE:ink,false);t.setPadding(14,12,14,12);t.setBackground(round(user?blue:Color.WHITE,18));t.setMaxWidth((int)(getResources().getDisplayMetrics().widthPixels*.82f));row.addView(t,new LinearLayout.LayoutParams(-2,-2));
    if(persist){try{JSONObject m=new JSONObject();m.put("text",s);m.put("user",user);current.put(m);}catch(Exception ignored){}}
  }
  void startVoiceInput(){
    Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"ru-RU");intent.putExtra(RecognizerIntent.EXTRA_PROMPT,"Продиктуй сообщение для Helio");intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,1);
    try{startActivityForResult(intent,REQUEST_VOICE_INPUT);}catch(ActivityNotFoundException e){Toast.makeText(this,"На устройстве нет службы распознавания речи",Toast.LENGTH_LONG).show();}
  }  String solve(String raw){String q=raw.trim(),lower=raw.toLowerCase(Locale.ROOT);
    String chat=smallTalk(lower);if(chat!=null)return chat;
    if(q.matches(".*[0-9].*")||q.matches(".*[=+*/^()√π²³×÷·].*")||lower.matches(".*(реши|вычисли|посчитай|производн|интеграл|площад|периметр|объ[её]м|радиус|диаметр|треугольник|квадрат|кубоид|параллелепипед).*")){
      try{PyObject result=Python.getInstance().getModule("math_engine").callAttr("solve",q,grade,model);if(result!=null)return result.toString();}catch(Exception e){return "Не получилось запустить SymPy. Попробуй ещё раз или введи задачу короче.";}
    }
    try{if(lower.matches(".*(площад|периметр|объ[её]м|радиус|диаметр|сторон).*")){String g=geometry(lower);if(g!=null)return g;}
      if(q.contains("=")&&q.matches(".*[xX].*"))return solveEquation(q);
      String expr=q.replaceAll("(?i)^(реши|вычисли|посчитай|найди|сколько будет)\\s*[: ]*","").replace("×","*").replace("÷","/").replace("·","*").replace("⋅","*").replace("−","-").replace(",",".");
      expr=expr.replace("²","^2").replace("³","^3").replace("⁴","^4").replace("⁵","^5").replace("⁰","^0").replace("¹","^1");
      if(!expr.matches(".*[0-9].*")&&!expr.contains("="))return "Я пока лучше всего помогаю с математикой, но поболтать тоже можно 🙂 Расскажи, что у тебя на уме.";
      double v=new Parser(expr,0).parse();String result=fmt(v);
      if(model.equals("Helio Gen 1 Flash"))return "Ответ: "+result;
      return "Разберём выражение:\n"+expr+"\nСначала выполняем действия в скобках, затем степени, умножение и деление, после этого сложение и вычитание.\nОтвет: "+result;
    }catch(Exception e){return "Похоже, я не совсем понял запись. Напиши пример обычными цифрами и знаками. Понимаю ×, ·, ÷, степени ²/³, скобки и дроби.";}}
  String smallTalk(String q){
    if(q.matches(".*\\b(привет|здравствуй|здравствуйте|хай|салам|салом|hello|hi)\\b.*"))return "Привет! 🙂 Рад тебя видеть. Что сегодня разберём — математику или просто поговорим?";
    if(q.matches(".*(как дела|как ты|как настроение).*"))return "Всё хорошо, спасибо 🙂 Готов помочь тебе. А у тебя как дела?";
    if(q.matches(".*(спасибо|благодарю|красава|молодец).*"))return "Пожалуйста! 🙂 Если хочешь, разберём ещё одну задачу.";
    if(q.matches(".*\\b(пока|до свидания|увидимся|bye)\\b.*"))return "Пока! Удачи тебе 👋 Возвращайся, когда понадобится помощь.";
    if(q.matches(".*(кто ты|как тебя зовут|ты кто).*"))return "Я Helio — школьный помощник. Для математических вычислений использую SymPy.";
    if(q.matches(".*(помоги|что ты умеешь|что умеешь|помощь).*"))return "Могу посчитать выражение, решить простое линейное или квадратное уравнение и помочь с площадью круга или квадрата. Примеры: 2214÷(12²+15²)+36 или 3x+5=20.";
    return null;
  }
  String geometry(String q){try{if(q.contains("круг")||q.contains("окруж")){double r=first(q,"(?:радиус|r)\\s*(?:=|:)?\\s*(\\d+(?:\\.\\d+)?)");if(!q.contains("радиус")&&!q.contains("r"))r=first(q,"круг\\s*(\\d+(?:\\.\\d+)?)");return "Площадь круга S = πr².\nr = "+fmt(r)+"\nS = π × "+fmt(r)+"² ≈ "+fmt(Math.PI*r*r)+" квадратных единиц.";}}catch(Exception ignored){}try{if(q.contains("квадрат")){double a=first(q,"(?:сторона|сторон|квадрат)\\s*(?:=|:)?\\s*(\\d+(?:\\.\\d+)?)");return "Квадрат со стороной a = "+fmt(a)+":\nПериметр P = 4a = "+fmt(4*a)+".\nПлощадь S = a² = "+fmt(a*a)+".";}}catch(Exception ignored){}return null;}
  double first(String text,String regex){java.util.regex.Matcher m=java.util.regex.Pattern.compile(regex).matcher(text);if(m.find())return Double.parseDouble(m.group(1));throw new IllegalArgumentException();}
  String solveEquation(String q){String[] sides=q.split("=",-1);if(sides.length!=2)throw new IllegalArgumentException();String l=sides[0].replaceAll("(?i)реши|уравнение","").replace(" ",""),r=sides[1].replace(" ","");double f0=new Parser(l,0).parse()-new Parser(r,0).parse(),f1=new Parser(l,1).parse()-new Parser(r,1).parse(),f2=new Parser(l,2).parse()-new Parser(r,2).parse();double a=(f2-f0)/2,b=f1-f0-a;if(Math.abs(a)>1e-9){double d=b*b-4*a*f0;if(d<0)return "Уравнение не имеет действительных корней (дискриминант меньше нуля).";return "Квадратное уравнение:\nD = b² − 4ac = "+fmt(d)+".\nКорни: x₁ = "+fmt((-b+Math.sqrt(d))/(2*a))+", x₂ = "+fmt((-b-Math.sqrt(d))/(2*a))+".";}if(Math.abs(b)<1e-9)return Math.abs(f0)<1e-9?"Равенство верно при любом x.":"Решений нет: переменная сокращается, остаётся неверное равенство.";return "Решение по шагам:\n1. Переносим слагаемые влево.\n2. Получаем "+fmt(b)+"x + ("+fmt(f0)+") = 0.\n3. Делим на коэффициент при x.\nОтвет: x = "+fmt(-f0/b)+".";}
  String fmt(double n){if(!Double.isFinite(n))throw new IllegalArgumentException();if(Math.abs(n-Math.rint(n))<1e-10)return String.valueOf((long)Math.rint(n));return String.format(Locale.US,"%.6f",n).replaceAll("0+$","").replaceAll("\\.$","");}
  class Parser {String s;int p;double x;Parser(String s,double x){this.s=s.replace("π",String.valueOf(Math.PI)).replace("√(","sqrt(").replace("−","-").replace(" ","").toLowerCase(Locale.ROOT);this.x=x;}double parse(){double v=add();if(p<s.length())throw new IllegalArgumentException();return v;}boolean eat(char c){if(p<s.length()&&s.charAt(p)==c){p++;return true;}return false;}double add(){double v=mul();while(true){if(eat('+'))v+=mul();else if(eat('-'))v-=mul();else return v;}}double mul(){double v=pow();while(true){if(eat('*'))v*=pow();else if(eat('/'))v/=pow();else if(p<s.length()&&(s.charAt(p)=='x'||s.charAt(p)=='('))v*=pow();else return v;}}double pow(){double v=atom();if(eat('^'))v=Math.pow(v,pow());return v;}double atom(){if(eat('+'))return atom();if(eat('-'))return-atom();if(eat('(')){double v=add();if(!eat(')'))throw new IllegalArgumentException();return v;}int st=p;while(p<s.length()&&(Character.isDigit(s.charAt(p))||s.charAt(p)=='.'))p++;if(st<p)return Double.parseDouble(s.substring(st,p));while(p<s.length()&&Character.isLetter(s.charAt(p)))p++;if(st==p)throw new IllegalArgumentException();String n=s.substring(st,p);if(n.equals("x"))return x;if(n.equals("pi"))return Math.PI;if(n.equals("e"))return Math.E;if(!eat('('))throw new IllegalArgumentException();double a=add();if(!eat(')'))throw new IllegalArgumentException();switch(n){case"sqrt":return Math.sqrt(a);case"sin":return Math.sin(a);case"cos":return Math.cos(a);case"tan":return Math.tan(a);case"ln":return Math.log(a);case"log":return Math.log10(a);case"abs":return Math.abs(a);default:throw new IllegalArgumentException();}}}
  void newChat(boolean redraw){chatId=UUID.randomUUID().toString();current=new JSONArray();JSONObject obj=new JSONObject();try{obj.put("id",chatId);obj.put("title","Новый чат");obj.put("messages",current);chats.add(0,obj);}catch(Exception ignored){}saveChats();if(redraw)render();}
  void loadChats(){try{JSONArray a=new JSONArray(prefs.getString("chats","[]"));for(int i=0;i<a.length();i++)chats.add(a.getJSONObject(i));}catch(Exception ignored){}}
  void saveChats(){try{for(JSONObject c:chats)if(c.optString("id").equals(chatId)){c.put("messages",current);for(int i=0;i<current.length();i++)if(current.optJSONObject(i).optBoolean("user")){String t=current.optJSONObject(i).optString("text");c.put("title",t.substring(0,Math.min(32,t.length())));break;}break;}JSONArray a=new JSONArray();for(JSONObject c:chats)a.put(c);prefs.edit().putString("chats",a.toString()).apply();}catch(Exception ignored){}}
  void showHistory(){ArrayList<String> names=new ArrayList<>();for(JSONObject c:chats)names.add(c.optString("title","Новый чат"));names.add("＋  Новый чат");String[] opts=names.toArray(new String[0]);new android.app.AlertDialog.Builder(this).setTitle("История чатов").setItems(opts,(d,w)->{if(w==opts.length-1){newChat(true);return;}JSONObject c=chats.get(w);chatId=c.optString("id");current=c.optJSONArray("messages");if(current==null)current=new JSONArray();render();}).setNegativeButton("Закрыть",null).show();}
  TextView label(String s,int size,int color,boolean bold){TextView t=new TextView(this);t.setText(s);t.setTextSize(size);t.setTextColor(color);if(bold)t.setTypeface(null,Typeface.BOLD);return t;}
  GradientDrawable round(int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(radius);return d;}
}
