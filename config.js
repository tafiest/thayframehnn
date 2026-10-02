/*
 * CẤU HÌNH TRANG — sửa chữ, màu, tên file tại đây. Không cần đụng vào app.js.
 * Lưu ý: giữ nguyên dấu ngoặc kép "..." và dấu phẩy cuối mỗi dòng.
 */
window.APP_CONFIG = {
  // Tiêu đề tab trình duyệt và tiêu đề trên trang
  pageTitle: "Thay avatar Hunonic Store",
  heading: "Thay avatar cùng Hunonic Store",
  subheading: "Hàng chính hãng – Giá độc quyền tại Hunonic Store",

  // Hướng dẫn hiển thị dưới khung ảnh (mỗi dòng một bước)
  steps: [
    "Bấm “Chọn ảnh” để tải ảnh của bạn lên",
    "Kéo để di chuyển, chụm 2 ngón hoặc dùng thanh trượt để phóng to",
    "Bấm “Tải ảnh HD” để lưu ảnh nét về máy, rồi đặt làm ảnh đại diện",
  ],

  // Caption gợi ý để người dùng sao chép khi đăng (để "" nếu không dùng)
  caption: "Mình đã thay avatar cùng Hunonic Store! #Hunonic #HunonicStore",

  // Màu chủ đạo của trang
  colors: {
    primary: "#12b83a",     // nút chính
    primaryDark: "#0b8a2b", // nút khi bấm
    background: "#eefbf1",  // nền trang
    text: "#10331b",        // chữ
  },

  // File frame (PNG, vùng ảnh phải trong suốt)
  frameSrc: "assets/frame.png",

  // Tên file khi tải về
  downloadFileName: "hunonic-avatar.png",

  // Phóng to tối đa (so với mức vừa khít khung)
  maxZoom: 5,

  // Dòng chữ cuối trang (để "" nếu không dùng)
  footer: "© Hunonic Store",
};
