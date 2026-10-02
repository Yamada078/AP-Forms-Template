[English](README.md) · **ภาษาไทย**

สำหรับการเริ่มใช้รุ่นบัญชีองค์กร ดู [คู่มือติดตั้ง](docs/deployment.md) และ [คู่มือสมาชิก](docs/organization-guide.md)

# AP+forms · ตัวแอป

ซอร์สหน้าเว็บ API และการตั้งค่า Cloudflare อยู่ในโฟลเดอร์นี้ คำสั่งติดตั้งและตรวจสอบระบบรันจากตำแหน่งนี้

- [ติดตั้งระบบของคุณเอง](docs/deployment.md)
- [เริ่มเชื่อม API](docs/api-quickstart.md)
- [คู่มือ API](docs/integration.md)
- [คู่มือใช้งาน](docs/user-guide.md)
- [การพัฒนา](docs/development.md)

## คำสั่งที่ใช้บ่อย

| คำสั่ง | การใช้งาน |
| --- | --- |
| `npm ci` | ติดตั้งเครื่องมือจากเวอร์ชันใน lockfile |
| `npm run key:local` | สร้างรหัสทีมสำหรับเครื่องของคุณ |
| `npm run db:setup:local` | สร้างตารางในฐานข้อมูล local ที่ยังว่าง |
| `npm run dev` | เปิดเว็บและ API บนเครื่อง |
| `npm test` | ตรวจสอบระบบด้วยข้อมูลจำลอง |
| `npm run check:build` | ตรวจการรวมซอร์สสำหรับ deploy |
| `npm run deploy` | เผยแพร่ไปยัง Worker ที่ตั้งไว้ |

`wrangler.jsonc` มีค่าฐานข้อมูลตัวอย่าง เปลี่ยนชื่อและ ID เป็นฐานข้อมูลของคุณก่อน deploy ส่วนรหัสทีม local เก็บใน `.dev.vars` และรหัสทีมบนเว็บตั้งผ่าน Cloudflare Secrets

[กลับหน้าโครงงาน](../README.th.md)
