[English](en/development.md) · **ภาษาไทย**

# การพัฒนา AP+forms

ใช้ Node.js 24 ขึ้นไป รันคำสั่งจากโฟลเดอร์ `app`

```powershell
npm ci
npm test
npm run check:build
```

การทดสอบใช้ข้อมูลจำลองและ SQLite ในหน่วยความจำ ส่วน `check:build` รวม Worker และ assets เพื่อดูว่าซอร์สพร้อม deploy ได้หรือไม่

## โครงสร้างซอร์ส

| ตำแหน่ง | หน้าที่ |
| --- | --- |
| `src/entry.js` | จุดเข้า Worker และการโหลด Builder |
| `src/index.js` | ฟอร์ม การเผยแพร่ คำตอบ และการทำงานร่วมกัน |
| `src/integration.js` | แอป สิทธิ์ และ API สำหรับแอปที่เชื่อมต่อ |
| `src/question-banks.js` | คลังคำถาม แท็ก และความพร้อมของคำถาม |
| `src/question-bank-packages.js` | แพ็กเกจนำเข้าและส่งออกคลังคำถาม |
| `src/question-packs.js` | การจัดชุด การสุ่ม และเวอร์ชันคำถาม |
| `src/assessments.js` | รอบการประเมินและการตรวจคำตอบ |
| `public/` | หน้าเว็บ ตัวแก้ไข Logic และ Question Studio |
| `database/bootstrap.sql` | โครงสร้างสำหรับฐานข้อมูลใหม่ |
| `migrations/` | การเปลี่ยนโครงสร้างแต่ละช่วงของระบบ |

## เปลี่ยนโครงสร้างฐานข้อมูล

เมื่อแก้ `schema.sql` หรือเพิ่ม migration ให้อัปเดตรายการใน `scripts/generate-bootstrap-schema.mjs` แล้วสร้าง bootstrap ใหม่:

```powershell
npm run db:generate
npm test
```

ชุดทดสอบ bootstrap ตรวจว่าฐานข้อมูลใหม่สร้างตารางครบ และเรียก API พื้นฐานได้โดยไม่มีข้อมูลตั้งต้นจากระบบอื่น

## ตรวจหน้าจอ

ตรวจ Worker จริงบนเครื่องตาม [คู่มือติดตั้ง](deployment.md) หรือใช้หน้า fixture สำหรับดู UI ด้วยข้อมูลจำลอง:

```powershell
node tests/ui-fixture-server.mjs
```

สำหรับ Logic และกิจกรรมคำถามมี `tests/logic-canvas-server.mjs` และ `tests/question-activity-server.mjs` แยกให้ใช้งาน หน้า fixture เป็นข้อมูลทดสอบ ส่วน login ฐานข้อมูล และการทำงานร่วมกันควรตรวจกับ Worker local เพิ่มเติม

## เก็บค่าของเครื่องคุณ

รหัส local อยู่ใน `.dev.vars` ซึ่งถูกยกเว้นจาก Git ส่วนค่าตัวอย่างอยู่ใน `.dev.vars.example` รหัสบนเว็บใช้ Cloudflare Secrets

ชื่อที่ใช้เป็นรหัสภายในและรูปแบบไฟล์เดิมอาจมี prefix เก่าอยู่ เก็บรหัสเหล่านี้ไว้เพื่อรองรับข้อมูลและแพ็กเกจที่มีอยู่

## สื่อและบริการประกอบ

รูป เสียง และไฟล์ตกแต่ง deploy ไปพร้อมเว็บ ดู [คู่มือสื่อ](../public/assets/README.md) และ [รูปคำถาม](../public/assets/question-media/README.md)

หน้าการเผยแพร่สร้าง QR code ผ่าน QuickChart โดยส่ง URL สาธารณะของฟอร์มให้บริการนั้น หากปรับระบบ QR code ควรตรวจการแชร์ลิงก์และการแสดงผลเพิ่มด้วย

[กลับหน้าโครงงาน](../../README.th.md)
