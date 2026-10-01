# Thay avatar Hunonic Store

Trang web giúp nhân viên và khách hàng ghép ảnh của mình vào khung Hunonic Store, rồi tải ảnh về để đặt làm avatar.

- Chạy hoàn toàn trên trình duyệt: ảnh của người dùng **không gửi lên server nào**.
- Ảnh tải về là PNG **1200×1200**, bằng đúng độ phân giải của file frame.

## Tính năng
- Chọn ảnh bằng nút bấm, kéo thả ảnh vào khung (máy tính) hoặc dán ảnh bằng Ctrl+V.
- Kéo để di chuyển ảnh, chụm 2 ngón để phóng to. Trên máy tính dùng lăn chuột hoặc phím mũi tên và `+` / `-`.
- Thanh trượt phóng to, thanh trượt xoay ±45°, nút xoay 90°, lật ngang, đặt lại, đổi ảnh.
- Ảnh luôn phủ kín vòng tròn, không bao giờ lộ khoảng trống.
- Ảnh chụp từ điện thoại tự xoay đúng chiều. Ảnh quá lớn được thu nhỏ an toàn để không làm treo máy.
- Trên iPhone và trong Zalo/Facebook: trang hiện ảnh kết quả để người dùng **nhấn giữ → Lưu ảnh**, vì các trình duyệt này không tải file trực tiếp được.

## Sửa chữ, màu, tên file
Mở file **`config.js`** và sửa nội dung trong dấu ngoặc kép. Có thể sửa ngay trên GitHub: mở file, bấm biểu tượng bút chì, sửa xong bấm *Commit changes*.

## Đổi frame khác
1. Xuất frame dạng **PNG vuông**, phần đặt ảnh phải **trong suốt**.
2. Thay file `assets/frame.png`, giữ nguyên tên file.

Code tự tìm vùng trong suốt nên không cần sửa gì thêm.

Nếu frame có vùng ảnh là **màu trắng** thay vì trong suốt, chạy script sau để đục lỗ:
```
pip install pillow numpy scipy
python3 tools/cut_frame.py Avt.png assets/frame.png
```

## Đưa lên web miễn phí (GitHub Pages)
1. Vào repo trên GitHub → **Settings** → **Pages**.
2. Mục *Source*: chọn **Deploy from a branch**. *Branch*: chọn **main**, thư mục **/ (root)**, rồi bấm **Save**.
3. Đợi khoảng 1–2 phút. Trang web sẽ ở địa chỉ `https://tafiest.github.io/thayframehnn/`.

> Lưu ý: trang phải mở qua web (http/https). Mở trực tiếp file `index.html` trên máy sẽ không xuất được ảnh, vì trình duyệt chặn đọc ảnh từ file cục bộ.
>
> Để thử trên máy, chạy lệnh `python3 -m http.server` trong thư mục repo rồi mở `http://localhost:8000`.
