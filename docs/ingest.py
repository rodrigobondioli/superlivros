#!/usr/bin/env python3
# Superlivros - ingestao de um PDF novo.
# Gera: pack de leitura (INICIO/MEIO/FIM), trecho txt (~7k) e capa 320px jpg.
import os,re,sys,json,hashlib,subprocess,unicodedata
from PIL import Image

BASE=os.path.expanduser("~/mnt/Livros em PDF")
OUT=os.path.expanduser("~/ing/out")
os.makedirs(OUT,exist_ok=True)
BUDGET=7000; WINDOWS=[0.25,0.50,0.72]; PAGES_PER_WIN=2

def pages_of(pdf):
    o=subprocess.run(["pdfinfo",pdf],capture_output=True,text=True,timeout=60).stdout
    m=re.search(r"Pages:\s+(\d+)",o); return int(m.group(1)) if m else 0
def pdftext(pdf,f,l):
    r=subprocess.run(["pdftotext","-q","-f",str(f),"-l",str(l),pdf,"-"],capture_output=True,text=True,timeout=120)
    return r.stdout or ""
def clean(t):
    t=t.replace("\x0c"," "); out=[]
    for ln in t.split("\n"):
        s=ln.strip()
        if not s: continue
        if re.fullmatch(r"[\d\W]{0,6}",s): continue
        out.append(s)
    return re.sub(r"\s+"," "," ".join(out)).strip()
def snap(t,b):
    if len(t)<=b: return t
    c=t[:b]; p=max(c.rfind(". "),c.rfind("! "),c.rfind("? "))
    if p>b*0.6: c=c[:p+1]
    return c.strip()

def trecho(pdf,n):
    lo=max(1,int(0.08*n)); hi=max(lo+1,int(0.85*n)); span=hi-lo
    per=BUDGET//len(WINDOWS); parts=[]
    for w in WINDOWS:
        st=lo+int(span*w); f=max(1,st); l=min(n,st+PAGES_PER_WIN-1)
        t=clean(pdftext(pdf,f,l))
        if len(t)<200: t=clean(pdftext(pdf,f,min(n,l+1)))
        parts.append(snap(t,per+400))
    return snap(" [...] ".join(p for p in parts if p),BUDGET)

def pack(pdf,n,nome):
    blocos=[("INICIO (indice/intro)",1,min(n,18)),
            ("MEIO",max(1,int(n*0.40)),min(n,int(n*0.40)+14)),
            ("FIM",max(1,int(n*0.78)),min(n,int(n*0.78)+14))]
    s="LIVRO: %s\nPAGINAS: %d\n"%(nome,n)
    for t,f,l in blocos:
        s+="\n=== %s ===\n"%t+snap(clean(pdftext(pdf,f,l)),9000)+"\n"
    return s

def capa(pdf,dest):
    tmp=os.path.join(OUT,"_capa")
    subprocess.run(["pdftoppm","-jpeg","-r","110","-f","1","-l","1",pdf,tmp],timeout=120)
    cands=[f for f in os.listdir(OUT) if f.startswith("_capa")]
    if not cands: return False
    im=Image.open(os.path.join(OUT,cands[0])).convert("RGB")
    w,h=im.size; nh=int(h*320/w)
    im.resize((320,nh),Image.LANCZOS).save(dest,"JPEG",quality=82,optimize=True)
    for f in cands: os.remove(os.path.join(OUT,f))
    return True

def main():
    pdf=sys.argv[1]; cat=sys.argv[2]
    nome=os.path.basename(pdf)
    h=hashlib.md5((cat+"/"+nome).encode()).hexdigest()
    n=pages_of(pdf)
    print("arquivo:",nome); print("paginas:",n); print("hash:",h)
    open(os.path.join(OUT,h+".pack.txt"),"w").write(pack(pdf,n,nome))
    open(os.path.join(OUT,h+".txt"),"w").write(trecho(pdf,n))
    ok=capa(pdf,os.path.join(OUT,h+".jpg"))
    print("capa:",ok)
    print("saida em ~/ing/out/")
    for f in sorted(os.listdir(OUT)):
        if f.startswith(h): print("  ",f,os.path.getsize(os.path.join(OUT,f)))

main()
