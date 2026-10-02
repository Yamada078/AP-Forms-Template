# เชื่อมต่อแอปกับ AP+forms

แอปที่เชื่อมต่ออ่านฟอร์มและชุดคำถามจากเวอร์ชันที่เผยแพร่แล้ว การแก้ไขฉบับร่างจึงไม่เปลี่ยนข้อมูลที่แอปกำลังใช้งาน

ก่อนใช้ API ทำตาม [คู่มือติดตั้ง](deployment.md) ให้ครบ ฐานข้อมูลใหม่ที่เตรียมด้วย `bootstrap.sql` มีตารางและสิทธิ์ที่ API ใช้อยู่แล้ว

## สร้างสิทธิ์ให้แอป

สร้าง Application ในหน้าแอปพลิเคชัน เลือก permissions ฟอร์ม และชุดคำถามที่อนุญาต แล้วสร้างรหัสเชื่อมต่อให้แอปนั้น

รหัสที่สร้างจะแสดงเพียงครั้งเดียว ระบบเก็บ SHA-256 hash และ prefix สำหรับระบุรหัส รองรับหลายรหัสที่ยังใช้งานอยู่เพื่อให้เปลี่ยนรหัสได้โดยสร้างรหัสใหม่ ย้ายแอปมาใช้ แล้วค่อยยกเลิกรหัสเดิม

API ฝั่งผู้ดูแลใช้ header:

```http
Authorization: Bearer <TEAM_KEY>
```

| วิธี | เส้นทางต่อท้าย `/api/admin/integrations/applications` | การใช้งาน |
| --- | --- | --- |
| `GET`, `POST` | — | อ่านรายการหรือสร้างแอป |
| `PATCH` | `/{applicationId}` | แก้ไขหรือเปลี่ยนสถานะแอป |
| `DELETE` | `/{applicationId}` | ลบแอปที่ยกเลิกแล้ว |
| `PUT` | `/{applicationId}/permissions` | กำหนดสิทธิ์ |
| `PUT` | `/{applicationId}/forms` | กำหนดฟอร์มที่ใช้ได้ |
| `PUT` | `/{applicationId}/question-packs` | กำหนดชุดคำถามที่ใช้ได้ |
| `POST` | `/{applicationId}/credentials` | สร้างรหัสเชื่อมต่อ |
| `POST` | `/{applicationId}/credentials/{credentialId}/revoke` | ยกเลิกรหัส |
| `DELETE` | `/{applicationId}/credentials/{credentialId}` | ลบรหัสที่ยกเลิกแล้ว |

การกำหนดฟอร์มรับ `{ "formIds": ["..."] }` โดยใช้ ID ภายในของฟอร์ม รายการว่างหมายถึงไม่อนุญาตให้ใช้ฟอร์มใด การสร้างลิงก์สาธารณะใหม่ไม่ทำให้สิทธิ์นี้หาย สามารถเพิ่มสิทธิ์ให้ฟอร์มที่เผยแพร่แล้ว

การกำหนดชุดคำถามรับ `{ "packIds": ["..."] }` และเลือกได้จากชุดที่มีเวอร์ชันเผยแพร่แล้ว

## API สำหรับแอป

ใช้รหัสเชื่อมต่อของ Application ใน header:

```http
Authorization: Bearer <integration credential>
Content-Type: application/json
```

`TEAM_KEY` ใช้สำหรับผู้ดูแล ไม่ใช้แทนรหัสของแอป

### ฟอร์ม

| วิธี | เส้นทาง | สิทธิ์ที่ใช้ |
| --- | --- | --- |
| `GET` | `/api/integrations/forms/{publicId}/schema` | `read_form_schema` |
| `POST` | `/api/integrations/forms/{publicId}/responses` | `submit_response` |

ทั้งสองเส้นทางต้องได้รับสิทธิ์สำหรับฟอร์มนั้นด้วย หากต้องการใช้เวอร์ชันแน่นอน ระบุ `?version={publishedVersion}` ตอนอ่าน schema และ `publishedVersion` ตอนส่งคำตอบ

ตัวอย่างโครงสร้าง payload สำหรับส่งคำตอบ ค่าใน `answers` ต้องตรงกับคำถามใน schema ของฟอร์ม:

```json
{
  "publishedVersion": 4,
  "respondentMeta": {},
  "answers": {},
  "source": {
    "version": "0.4.7",
    "session": "session_abc",
    "platform": "windows",
    "metadata": {
      "scene": "example-step"
    }
  }
}
```

ระบบตรวจคำตอบด้วยกฎเดียวกับฟอร์มสาธารณะ และกำหนด `source_app_id` จากรหัสที่ยืนยันตัวตน แอปส่งค่าเพื่อเปลี่ยนเจ้าของข้อมูลนี้ไม่ได้

### ชุดคำถาม

| วิธี | เส้นทาง | สิทธิ์ที่ใช้ |
| --- | --- | --- |
| `GET` | `/api/integrations/question-packs` | `read_question_pack` |
| `GET` | `/api/integrations/question-packs/{packId}` | `read_question_pack` |
| `POST` | `/api/integrations/question-packs/{packId}/grade` | `submit_game_result` |
| `POST` | `/api/integrations/question-packs/{packId}/questions/{questionId}/grade` | `submit_game_result` |

แอปต้องอยู่ในรายการที่อนุญาตให้ใช้ชุดนั้นด้วย ข้อมูลชุดคำถามที่ส่งให้แอปไม่รวมเฉลยหรือบันทึกภายใน การตรวจคำตอบทำที่ API

## จัดการรหัสและคำขอ

เก็บรหัสเชื่อมต่อในเซิร์ฟเวอร์ของแอปหรือ proxy ที่ดูแลได้ ไม่ใส่รหัสไว้ในตัวเกมหรือหน้าเว็บที่แจกให้ผู้เล่น

คำขอใช้ JSON โดย payload คำตอบฟอร์มมีขนาดสูงสุด 256 KiB และ `source.metadata` สูงสุด 16 KiB ระบบจำกัดความถี่คำขอเบื้องต้นภายใน Worker แต่ละ isolate แอปควรเก็บ schema ของเวอร์ชันที่ใช้งานไว้และหลีกเลี่ยงการอ่านซ้ำโดยไม่จำเป็น

การเพิ่มเวอร์ชันใหม่ไม่เปลี่ยนเวอร์ชันที่แอประบุไว้ ควรทดสอบคำถามและรูปแบบคำตอบก่อนเปลี่ยนเวอร์ชันที่แอปใช้

[กลับหน้าตัวแอป](../README.md)
