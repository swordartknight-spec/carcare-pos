# Bike Services POS

PWA สำหรับจัดการบริการมอเตอร์ไซค์ Shell Station

## ฟีเจอร์
- PIN Login + เลือกสาขา (ช่าง / แคชเชียร์ / ผู้จัดการ)
- Checklist ตรวจรถ (สกู๊ตเตอร์ / มาเนียล) พร้อมเวลาและราคา upsell
- POS ขายบริการ + อะไหล่ 18 รายการ
- ค่าคอมช่างอัตโนมัติทุกรายการ
- สรุปยอดรายวัน — รายได้ + ค่าคอม + รถที่ตรวจ
- Firebase Firestore backend
- PWA — ติดตั้งบนมือถือได้

## วิธี Setup

### 1. Firebase
1. ไปที่ https://console.firebase.google.com
2. สร้าง project ใหม่
3. เปิด Firestore Database (mode: production)
4. ตั้ง Security Rules:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /bikeJobs/{doc} {
      allow read, write: if true;
    }
  }
}
```
5. ไปที่ Project Settings > General > Your apps > Add app (Web)
6. Copy firebaseConfig และแทนที่ใน `index.html` บรรทัด `YOUR_API_KEY` ฯลฯ

### 2. GitHub Pages
```bash
git init
git add .
git commit -m "init bike pos"
git remote add origin https://github.com/YOUR_USERNAME/bike-pos.git
git push -u origin main
```
จากนั้นไปที่ Settings > Pages > Source: main branch

## PINs เริ่มต้น
| บทบาท | PIN |
|---|---|
| ช่าง | 1111 |
| แคชเชียร์ | 2222 |
| ผู้จัดการ | 9999 |

(แก้ไข PINs ได้ใน `index.html` ส่วน `const PINS`)

## สาขา
แก้รายชื่อสาขาได้ใน `index.html` ส่วน `<select id="login-branch">`
