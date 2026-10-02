# เริ่มเชื่อม API

ตัวอย่างนี้อ่าน schema ของฟอร์มจากเซิร์ฟเวอร์แอปของคุณ ใช้หลัง [ติดตั้ง AP+forms](deployment.md) และเผยแพร่ฟอร์มแล้ว

ดู [ตัวอย่างแอปที่อ่านฟอร์มและส่งคำตอบได้](app-integration-walkthrough.md) หากต้องการทดลองครบขั้นตอน

## เตรียมการเชื่อมต่อ

1. เข้าสู่ Builder และสร้างฟอร์มตัวอย่าง
2. เพิ่มคำถาม จากนั้น Publish และเปิดรับคำตอบ ตั้งสิทธิ์ผู้ตอบเป็นทุกคนที่มีลิงก์สำหรับตัวอย่าง API นี้
3. เปิดหน้าแอปพลิเคชัน สร้าง Application เช่น “Example application”
4. เลือก permission `read_form_schema` และเพิ่มฟอร์มตัวอย่างใน Allowed Forms
5. สร้างรหัสเชื่อมต่อและเก็บไว้ในเซิร์ฟเวอร์ของคุณ รหัสจะแสดงเพียงครั้งเดียว
6. คัดลอก Public ID ของฟอร์มจากข้อมูล Integration

## ทดลองอ่านฟอร์ม

ตัวอย่างใช้ Node.js 24 ขึ้นไป รันจาก root ของโปรเจกต์ ใน PowerShell:

```powershell
$env:API_BASE_URL = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev"
$env:PUBLIC_FORM_ID = "YOUR_PUBLIC_FORM_ID"
$env:INTEGRATION_KEY = Read-Host "Integration key" -MaskInput
node examples/read-form-schema.mjs
Remove-Item Env:INTEGRATION_KEY
```

`-MaskInput` ใช้กับ PowerShell 7 ขึ้นไป หากใช้ shell อื่น ตั้ง environment variables ชื่อเดียวกันแล้วรันไฟล์ตัวอย่าง ส่วน URL และ Public ID เปลี่ยนเป็นระบบของคุณ

เมื่อเรียกสำเร็จ terminal จะแสดงข้อมูล schema ของฟอร์ม หากต้องการใช้เวอร์ชันแน่นอน เพิ่ม `?version=เลขเวอร์ชัน` ใน schema endpoint

## ส่งคำตอบ

ให้ Application มี permission `submit_response` และสิทธิ์สำหรับฟอร์มนั้น แล้วส่ง JSON ไปที่:

```http
POST /api/integrations/forms/{publicId}/responses
Authorization: Bearer <integration credential>
Content-Type: application/json
```

ค่า `answers` ต้องอ้าง ID และรูปแบบของคำถามใน schema ตัวอย่างต่อไปนี้สมมติว่าฟอร์มมีคำถามข้อความ ID `question_1`:

```json
{
  "publishedVersion": 1,
  "respondentMeta": {},
  "answers": { "question_1": "ตัวอย่างคำตอบ" },
  "source": { "version": "1.0.0", "platform": "web" }
}
```

เปลี่ยนเวอร์ชันและ ID คำถามตามฟอร์มที่อ่านมา แล้วดูคำตอบที่ส่งในหน้า Responses ของ AP+forms

## ใช้ชุดคำถาม

สร้างและเผยแพร่ชุดคำถามก่อน จากนั้นให้ Application มี `read_question_pack`, `submit_game_result` และสิทธิ์สำหรับชุดนั้น อ่านชุดที่ `/api/integrations/question-packs/{packId}` และตรวจคำตอบที่เส้นทาง `/grade` ของชุด

รหัสเชื่อมต่อใช้ในเซิร์ฟเวอร์หรือ proxy ที่คุณดูแล อย่าใส่ในหน้าเว็บหรือเกมที่ส่งให้ผู้ใช้งาน ส่วน `TEAM_KEY` เป็นรหัสผู้ดูแลและไม่ใช้แทนรหัส Application

ข้อมูล permissions เวอร์ชัน และรูปแบบคำขอเพิ่มเติมอยู่ใน [คู่มือ API](integration.md)
