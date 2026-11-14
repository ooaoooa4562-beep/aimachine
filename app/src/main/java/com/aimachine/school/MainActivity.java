package com.aimachine.school;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.*;

public class MainActivity extends Activity {
  int ink=Color.rgb(25,35,53), muted=Color.rgb(116,128,145), blue=Color.rgb(76,105,255), bg=Color.rgb(246,248,252);
  LinearLayout root, messages; EditText input; int grade=7;
  public void onCreate(Bundle b){super.onCreate(b); getWindow().setStatusBarColor(bg);getWindow().setNavigationBarColor(Color.WHITE);getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
    root=new LinearLayout(this);root.setOrientation(1);root.setBackgroundColor(bg);setContentView(root);
    LinearLayout top=new LinearLayout(this);top.setPadding(20,18,20,12);top.setGravity(Gravity.CENTER_VERTICAL);top.setBackgroundColor(Color.WHITE);root.addView(top);
    TextView logo=label("✦",24,blue,true); top.addView(logo); TextView title=label("  Умная школа",20,ink,true);top.addView(title,new LinearLayout.LayoutParams(0,-2,1));
    TextView gradeBtn=label("7 класс⌄",14,ink,true);gradeBtn.setPadding(14,10,14,10);gradeBtn.setBackground(round(Color.rgb(242,244,249),18));top.addView(gradeBtn);gradeBtn.setOnClickListener(v->chooseGrade(gradeBtn));
    ScrollView scroll=new ScrollView(this);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));messages=new LinearLayout(this);messages.setPadding(20,20,20,12);messages.setOrientation(1);scroll.addView(messages);
    TextView hello=label("Привет! Я помогу разобраться с математикой — объясню решение по шагам, а не просто дам ответ.",16,ink,false);hello.setPadding(16,16,16,16);hello.setBackground(round(Color.WHITE,20));messages.addView(hello);
    TextView cap=label("ПОПРОБУЙ СПРОСИТЬ",11,muted,true);cap.setPadding(2,24,0,10);messages.addView(cap);
    for(String s:new String[]{"Реши уравнение 3x + 5 = 20","Объясни дроби простыми словами","Как найти площадь треугольника?"}){TextView c=label(s+"   →",14,ink,false);c.setPadding(15,14,15,14);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.bottomMargin=9;c.setBackground(round(Color.WHITE,16));messages.addView(c,lp);c.setOnClickListener(v->{input.setText(s);send();});}
    LinearLayout composer=new LinearLayout(this);composer.setPadding(14,12,14,18);composer.setGravity(Gravity.CENTER_VERTICAL);composer.setBackgroundColor(Color.WHITE);root.addView(composer);
    input=new EditText(this);input.setSingleLine(false);input.setMinLines(1);input.setMaxLines(3);input.setHint("Напиши задачу...");input.setTextSize(15);input.setPadding(14,10,12,10);input.setBackground(round(bg,18));composer.addView(input,new LinearLayout.LayoutParams(0,-2,1));
    TextView send=label("➤",20,Color.WHITE,true);send.setGravity(Gravity.CENTER);send.setBackground(round(blue,18));LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(48,48);sp.leftMargin=9;composer.addView(send,sp);send.setOnClickListener(v->send());
  }
  void chooseGrade(TextView button){String[] a=new String[11];for(int i=0;i<11;i++)a[i]=(i+1)+" класс";new android.app.AlertDialog.Builder(this).setTitle("Выбери класс").setItems(a,(d,w)->{grade=w+1;button.setText(grade+" класс⌄");}).show();}
  void send(){String q=input.getText().toString().trim();if(q.isEmpty())return; addBubble(q,true);input.setText("");String ans=solve(q);addBubble(ans,false);}
  void addBubble(String s,boolean user){TextView t=label(s,15,user?Color.WHITE:ink,false);t.setPadding(15,13,15,13);t.setBackground(round(user?blue:Color.WHITE,18));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.topMargin=10;p.leftMargin=user?38:0;p.rightMargin=user?0:20;messages.addView(t,p);}
  String solve(String q){String s=q.toLowerCase().replace(" ","");try{if(s.matches(".*\\d+x[+-]\\d+=\\d+.*")){java.util.regex.Matcher m=java.util.regex.Pattern.compile("(\\d+)x([+-])(\\d+)=(\\d+)").matcher(s);if(m.find()){int a=Integer.parseInt(m.group(1)),b=Integer.parseInt(m.group(3))*(m.group(2).equals("+")?1:-1),c=Integer.parseInt(m.group(4));double x=(double)(c-b)/a;return "Разберём по шагам:\n1. Перенесём число "+b+" в правую часть: "+a+"x = "+(c-b)+".\n2. Разделим обе части на "+a+".\nОтвет: x = "+x+"\n\nЭто учебный прототип — пока умеет только простые линейные уравнения.";}}}catch(Exception ignored){}return "Я пока учусь решать задачи. В этой версии работает разбор простых уравнений вида 3x + 5 = 20. Скоро добавим остальные темы для "+grade+" класса!";}
  TextView label(String s,int size,int color,boolean bold){TextView t=new TextView(this);t.setText(s);t.setTextSize(size);t.setTextColor(color);if(bold)t.setTypeface(null,Typeface.BOLD);return t;}
  GradientDrawable round(int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(radius);return d;}
}
