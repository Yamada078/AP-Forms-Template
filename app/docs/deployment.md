# ติดตั้ง AP+forms ของคุณเอง

คู่มือนี้เริ่มจากซอร์สและฐานข้อมูลใหม่ ผู้ติดตั้งจะมีเว็บ ฟอร์ม คำตอบ และรหัสเชื่อมต่อของตัวเอง

## เตรียมเครื่องมือ

- Node.js 24 ขึ้นไป พร้อม npm
- บัญชี Cloudflare สำหรับเผยแพร่เว็บ
- Git หากต้องการ clone ซอร์สหรือเชื่อมการ deploy กับ GitHub

ดาวน์โหลดซอร์สหรือสร้าง repository ของคุณจากตัวแจก แล้วเปิด terminal ในโฟลเดอร์ `app`

```powershell
cd app
npm ci
```

## ทดลองบนเครื่องก่อน

สร้างรหัสทีม local และตารางในฐานข้อมูล local ที่ยังว่าง:

```powershell
npm run key:local
npm run db:setup:local
npm run dev
```

เปิด URL ที่ Wrangler แสดงใน terminal รหัสทีมสำหรับเข้าสู่ Builder อยู่ในไฟล์ `.dev.vars` บนเครื่องของคุณ คำสั่งสร้างรหัสจะเก็บรหัสเดิมไว้หากมีไฟล์นี้อยู่แล้ว

เมื่อเข้าระบบได้ ลองสร้างฟอร์ม เพิ่มคำถาม เลือก Preview แล้ว Publish จากนั้นเปิดลิงก์สำหรับผู้ตอบและส่งคำตอบทดสอบ

ฐานข้อมูล local แยกจากฐานข้อมูลบน Cloudflare คำสั่งเตรียมตารางใช้กับฐานข้อมูลว่างครั้งแรก หากเคยตั้งตารางแล้ว ให้ข้าม `db:setup:local`

## สร้างฐานข้อมูลบน Cloudflare

เข้าสู่บัญชีของคุณและสร้างฐานข้อมูลใหม่:

```powershell
npx wrangler login
npx wrangler d1 create applus-forms-db
```

เลือกชื่อฐานข้อมูลอื่นได้หากต้องการแยกหลายระบบ คำสั่งจะคืน `database_id` ของฐานข้อมูลที่สร้าง

เปิด `wrangler.jsonc` แล้วตั้งค่าต่อไปนี้:

| ค่า | ใส่อะไร |
| --- | --- |
| `name` | ชื่อ Worker ของคุณ เช่น `my-forms` |
| `d1_databases[0].database_name` | ชื่อฐานข้อมูลที่เพิ่งสร้าง |
| `d1_databases[0].database_id` | ID ที่ Cloudflare คืนให้ |

ID ที่เป็นศูนย์ทั้งหมดในไฟล์ตัวแจกเป็นค่าตัวอย่าง ส่วน binding `DB`, `COLLAB` และ `ASSETS` ใช้ชื่อเดิมเพื่อให้ตรงกับโค้ด

## สร้างตารางและเผยแพร่

เมื่อชี้ไปยังฐานข้อมูลใหม่ที่ถูกต้องแล้ว:

```powershell
npm run db:setup:remote
npm run deploy
npx wrangler secret put TEAM_KEY
```

คำสั่งสุดท้ายจะให้กรอกรหัสทีมของระบบบนเว็บ ตั้งรหัสที่เดายากและเก็บไว้กับผู้ดูแลระบบ เปิด URL ของ Worker แล้วใช้ชื่อสมาชิกพร้อมรหัสนี้เข้าสู่ Builder

`db:setup:remote` สร้างตารางบนฐานข้อมูล Cloudflare ที่ระบุในไฟล์ตั้งค่าจริง ใช้กับฐานข้อมูลว่างครั้งแรก และข้ามขั้นตอนนี้เมื่อตารางมีอยู่แล้ว

`database/bootstrap.sql` รวมโครงสร้างตั้งต้นกับ migration ที่จำเป็นไว้แล้ว โดยข้าม `0002` เพราะ `schema.sql` มีคอลัมน์ `respondent_meta` อยู่แล้ว จึงไม่ต้องรัน migration ทุกไฟล์ซ้ำหลังใช้ bootstrap

Durable Object `FormRoom` ประกาศไว้ใน `exports` ของไฟล์ตั้งค่า Wrangler จะจัดการ namespace สำหรับการทำงานร่วมกันระหว่าง deploy

## ตรวจระบบหลังติดตั้ง

1. เปิด `/api/health` ตรวจว่า `db`, `teamKeyConfigured` และ `realtimeCollab` เป็น `true`
2. สร้างฟอร์มทดสอบและเผยแพร่
3. เปิดลิงก์ในอีกหน้าต่าง ส่งคำตอบ แล้วตรวจรายการ Responses
4. ทดลองคลังคำถามและชุดคำถาม หากต้องการใช้ส่วนนี้
5. สร้าง Application ใหม่สำหรับแอปที่ต้องการเชื่อม ตาม [คู่มือ API เริ่มต้น](api-quickstart.md)

ค่า health ตรวจว่ามีการตั้งค่า binding แต่การส่งและอ่านคำตอบทดสอบจะยืนยันการใช้งานฐานข้อมูลจริง

## เชื่อม GitHub เพื่ออัปเดตอัตโนมัติ

เมื่อ deploy ด้วยคำสั่งได้แล้ว สามารถนำ repository ของคุณไปเชื่อมใน Cloudflare → Worker เดิม → Settings → Build

| การตั้งค่า | ค่า |
| --- | --- |
| Repository | repository ของคุณ |
| Production branch | branch ที่ใช้เผยแพร่ เช่น `main` |
| Root directory | `app` |
| Build command | `npm ci` |
| Deploy command | `npm run deploy` |

ชื่อ Worker ใน Cloudflare ต้องตรงกับ `name` ใน `wrangler.jsonc` และไฟล์ตั้งค่าที่ push ต้องชี้ไปยังฐานข้อมูลของคุณ รหัสทีมตั้งที่ Worker ผ่าน Secrets

workflow ตรวจสอบในตัวแจกทำหน้าที่ทดสอบและตรวจ build การ deploy อัตโนมัติใช้การเชื่อมต่อที่คุณตั้งกับ Cloudflare

## อัปเดตระบบที่ติดตั้งแล้ว

เก็บค่าชื่อ Worker, ฐานข้อมูล และ Secrets ของระบบคุณไว้เมื่อนำซอร์สเวอร์ชันใหม่มาใช้ ตรวจ migration เพิ่มเติมตามบันทึกของรุ่นนั้น และสำรองข้อมูลก่อนเปลี่ยนโครงสร้างฐานข้อมูล

ฐานข้อมูลที่ตั้งตารางแล้วใช้ migration เพิ่มเติมตามความจำเป็น แทนการรัน `bootstrap.sql` ซ้ำ

## ถ้าติดตั้งไม่ผ่าน

- **Unauthorized ตอน login:** ตรวจว่าตั้ง `TEAM_KEY` แล้ว และใช้รหัสของสภาพแวดล้อมนั้น
- **ไม่พบตาราง:** ตรวจฐานข้อมูลที่ตั้งไว้ และขั้นตอน bootstrap ของฐานข้อมูลใหม่
- **คอลัมน์ซ้ำ:** อาจรัน bootstrap หรือ migration ซ้ำกับฐานข้อมูลที่ตั้งไว้แล้ว ให้ตรวจโครงสร้างก่อนรันต่อ
- **Worker name ไม่ตรง:** ทำให้ชื่อบน Cloudflare กับ `name` ในไฟล์ตั้งค่าตรงกัน
- **API ตอบ 403:** ตรวจ permissions และรายการฟอร์มหรือชุดคำถามที่ Application ใช้ได้

## เอกสารอ้างอิง

- [เริ่มใช้งาน Cloudflare D1](https://developers.cloudflare.com/d1/get-started/)
- [Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [การตั้งค่า Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Durable Object class exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)

[กลับหน้าโครงงาน](../../README.md)
