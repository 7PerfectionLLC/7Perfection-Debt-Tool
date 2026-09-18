const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const ADMIN_PIN = process.env.ADMIN_PIN || "2580";
if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) { throw new Error("JWT_SECRET must be set to a random secret of at least 32 characters in production."); }

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"100kb"}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname,"public")));
app.use(rateLimit({windowMs:15*60*1000,max:200,standardHeaders:true,legacyHeaders:false}));

const fs = require("fs");
fs.mkdirSync(path.join(__dirname,"data"), {recursive:true});
const db = new Database(path.join(__dirname,"data","7perfection.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 pin_hash TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 phone TEXT,
 debt_cents INTEGER NOT NULL,
 paid_cents INTEGER NOT NULL DEFAULT 0,
 archived INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 plates_count INTEGER NOT NULL DEFAULT 0,
 drinks_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER NOT NULL,
 amount_cents INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(customer_id) REFERENCES customers(id)
);
`);

// Upgrade older databases safely.
for (const col of ["plates_count", "drinks_count"]) {
  try { db.exec(`ALTER TABLE customers ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`); } catch (e) {
    if (!String(e.message).includes("duplicate column name")) throw e;
  }
}

if (db.prepare("SELECT COUNT(*) c FROM users").get().c === 0) {
  db.prepare("INSERT INTO users(name,pin_hash,created_at) VALUES(?,?,?)")
    .run("Lovely Pierre", bcrypt.hashSync(ADMIN_PIN, 12), new Date().toISOString());
}

function auth(req,res,next){
  const token=req.cookies.session;
  try{
    const p=jwt.verify(token,JWT_SECRET);
    req.user=p;
    next();
  }catch{
    return res.status(401).json({error:"Sesyon an fini. Konekte ankò."});
  }
}

app.post("/api/login",(req,res)=>{
  const pin=String(req.body.pin||"");
  const u=db.prepare("SELECT * FROM users WHERE id=1").get();
  if(!/^\d{4,6}$/.test(pin) || !bcrypt.compareSync(pin,u.pin_hash))
    return res.status(401).json({error:"PIN lan pa bon."});
  const token=jwt.sign({id:u.id,name:u.name},JWT_SECRET,{expiresIn:"8h"});
  res.cookie("session",token,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:8*60*60*1000});
  res.json({name:u.name});
});

app.post("/api/logout",(req,res)=>{res.clearCookie("session");res.json({ok:true})});

app.get("/api/me",auth,(req,res)=>res.json({name:req.user.name}));

app.get("/api/customers",auth,(req,res)=>{
  const rows=db.prepare(`
    SELECT c.*, COALESCE(SUM(p.amount_cents),0) AS paid_from_payments
    FROM customers c LEFT JOIN payments p ON p.customer_id=c.id
    GROUP BY c.id ORDER BY c.created_at DESC
  `).all();
  res.json(rows.map(c=>({...c,paid_cents:c.paid_cents,remaining_cents:Math.max(0,c.debt_cents-c.paid_cents)})));
});

app.post("/api/customers",auth,(req,res)=>{
  const name=String(req.body.name||"").trim();
  const phone=String(req.body.phone||"").trim();
  const debt=Number(req.body.debt);
  const plates=Math.max(0,Math.floor(Number(req.body.plates_count||0)));
  const drinks=Math.max(0,Math.floor(Number(req.body.drinks_count||0)));
  if(!name || !Number.isFinite(debt) || debt<=0) return res.status(400).json({error:"Non ak montan an obligatwa."});
  if(!Number.isFinite(plates) || !Number.isFinite(drinks)) return res.status(400).json({error:"Kantite yo pa valab."});
  const cents=Math.round(debt*100);
  const info=db.prepare("INSERT INTO customers(name,phone,debt_cents,plates_count,drinks_count,created_at) VALUES(?,?,?,?,?,?)")
    .run(name,phone,cents,plates,drinks,new Date().toISOString());
  res.json({id:info.lastInsertRowid});
});

app.post("/api/customers/:id/payments",auth,(req,res)=>{
  const id=Number(req.params.id), amount=Number(req.body.amount);
  const c=db.prepare("SELECT * FROM customers WHERE id=?").get(id);
  if(!c || c.archived) return res.status(404).json({error:"Kliyan an pa disponib."});
  const cents=Math.round(amount*100), remaining=c.debt_cents-c.paid_cents;
  if(!Number.isFinite(amount)||cents<=0||cents>remaining) return res.status(400).json({error:"Montan peman an pa valab."});
  const tx=db.transaction(()=>{
    db.prepare("INSERT INTO payments(customer_id,amount_cents,created_at) VALUES(?,?,?)").run(id,cents,new Date().toISOString());
    db.prepare("UPDATE customers SET paid_cents=paid_cents+? WHERE id=?").run(cents,id);
  });
  tx();
  const after=db.prepare("SELECT debt_cents,paid_cents FROM customers WHERE id=?").get(id);
  if(after.debt_cents===after.paid_cents) db.prepare("UPDATE customers SET archived=1 WHERE id=?").run(id);
  res.json({ok:true,remaining_cents:Math.max(0,after.debt_cents-after.paid_cents)});
});

app.patch("/api/customers/:id",auth,(req,res)=>{
  const id=Number(req.params.id), c=db.prepare("SELECT * FROM customers WHERE id=?").get(id);
  if(!c)return res.status(404).json({error:"Kliyan an pa jwenn."});
  const name=String(req.body.name??c.name).trim(), phone=String(req.body.phone??c.phone??"").trim();
  const debt=req.body.debt===undefined?c.debt_cents:Number(req.body.debt)*100;
  const plates=req.body.plates_count===undefined?c.plates_count:Math.max(0,Math.floor(Number(req.body.plates_count)));
  const drinks=req.body.drinks_count===undefined?c.drinks_count:Math.max(0,Math.floor(Number(req.body.drinks_count)));
  if(!name || !Number.isFinite(debt) || debt<c.paid_cents)return res.status(400).json({error:"Dèt la pa ka pi piti pase sa kliyan an deja peye."});
  if(!Number.isFinite(plates) || !Number.isFinite(drinks))return res.status(400).json({error:"Kantite yo pa valab."});
  db.prepare("UPDATE customers SET name=?,phone=?,debt_cents=?,plates_count=?,drinks_count=? WHERE id=?").run(name,phone,Math.round(debt),plates,drinks,id);
  res.json({ok:true});
});

app.delete("/api/customers/:id",auth,(req,res)=>{
  const id=Number(req.params.id), c=db.prepare("SELECT * FROM customers WHERE id=?").get(id);
  if(!c || !c.archived)return res.status(400).json({error:"Se sèlman dèt ki fini ki ka efase."});
  db.prepare("DELETE FROM payments WHERE customer_id=?").run(id);
  db.prepare("DELETE FROM customers WHERE id=?").run(id);
  res.json({ok:true});
});

app.get("/api/customers/:id/payments",auth,(req,res)=>{
  const rows=db.prepare("SELECT amount_cents,created_at FROM payments WHERE customer_id=? ORDER BY created_at DESC").all(Number(req.params.id));
  res.json(rows);
});

app.post("/api/change-pin",auth,(req,res)=>{
  const old=String(req.body.oldPin||""), next=String(req.body.newPin||"");
  const u=db.prepare("SELECT * FROM users WHERE id=1").get();
  if(!bcrypt.compareSync(old,u.pin_hash))return res.status(401).json({error:"PIN aktyèl la pa bon."});
  if(!/^\d{4,6}$/.test(next))return res.status(400).json({error:"Nouvo PIN lan dwe gen 4–6 chif."});
  db.prepare("UPDATE users SET pin_hash=? WHERE id=1").run(bcrypt.hashSync(next,12));
  res.clearCookie("session"); res.json({ok:true});
});

app.get("/{*splat}",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`7Perfection Debt Tool running on port ${PORT}`));
