import io,os,sys,json,base64,re
IDX=sys.argv[1]; ASSETS=sys.argv[2]; META=sys.argv[3]; MD=sys.argv[4]
meta=json.load(io.open(META,encoding='utf-8'))
h=meta['hash']
md=io.open(MD,encoding='utf-8').read().strip()
txt=io.open(os.path.join(ASSETS,h+'.txt'),encoding='utf-8').read().strip()
jpg=open(os.path.join(ASSETS,h+'.jpg'),'rb').read()
# a capa mora em capas/<hash>.jpg ao lado do index.html (desde 04/10/2026; antes ia em base64 dentro do BOOKS)
CAPAS=os.path.join(os.path.dirname(os.path.abspath(IDX)),'capas'); os.makedirs(CAPAS,exist_ok=True)
open(os.path.join(CAPAS,h+'.jpg'),'wb').write(jpg)
cover='capas/'+h+'.jpg'
book=dict(meta['book'])
book_out={"cat":book['cat'],"titulo":book['titulo'],"autor":book['autor'],
          "autor_norm":book['autor_norm'],"hash":h,"has_cover":True,"cover":cover,
          "file":book['file'],"desc":book['desc'],"muda":book['muda'],
          "ganchos":book['ganchos'],"txt":txt}
m=meta['mente']
mente_out={"id":h,"titulo":m['titulo'],"autor":m['autor'],"dominio":m['dominio'],
           "tese":m['tese'],"convoque":m['convoque'],"md":md}
s=io.open(IDX,encoding='utf-8').read()
def append(s, marcador, obj, label):
    i=s.index(marcador); fim=s.index('];\n', i)
    if h in s[i:fim]: print('JA EXISTE em',label); sys.exit(2)
    return s[:fim]+', '+json.dumps(obj,ensure_ascii=False)+s[fim:]
s=append(s,'const BOOKS = [', book_out,'BOOKS')
s=append(s,'const MENTES = [', mente_out,'MENTES')
io.open(IDX,'w',encoding='utf-8').write(s)
print('inserido:',h,'|',book['titulo'])
