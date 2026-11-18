# Hướng Dẫn Xuất File .APK Cho Ứng Dụng Tử Vi Tiên Cảnh Android

Do môi trường tạo ứng dụng không cài sẵn Android SDK nên mã nguồn đã được đóng gói thành dự án Android chuẩn hoàn chỉnh. Bạn có 3 cách cực nhanh để lấy file `.apk`:

## Cách 1: Xuất file `.apk` tự động trên Cloud bằng GitHub (Không cần cài Android Studio)
1. Tạo 1 repository mới (Private hoặc Public) trên **GitHub**.
2. Giải nén file `tu_vi_android_apk_project.zip` và tải toàn bộ thư mục (bao gồm cả thư mục ẩn `.github/workflows/build-apk.yml`) lên repository đó.
3. Vào tab **Actions** trên GitHub -> chọn **Build Android APK** -> đợi khoảng 2 phút.
4. Tải về file **`TuViTienCanh-Android-APK`** (chứa `app-debug.apk`) để cài thẳng lên điện thoại Android.

## Cách 2: Mở bằng Android Studio trên máy tính
1. Giải nén `tu_vi_android_apk_project.zip`.
2. Mở **Android Studio** -> chọn **Open** -> trỏ vào thư mục `tu_vi_android_apk_project`.
3. Chờ Gradle đồng bộ xong -> vào menu **Build -> Build Bundle(s) / APK(s) -> Build APK(s)**.

## Cách 3: Tạo APK siêu tốc trong 10 giây bằng Website2APK / AppsGeyser
- Lấy trực tiếp file `app/src/main/assets/index.html` nạp vào công cụ **Website 2 APK Builder** (chọn Local HTML Website -> thư mục chứa `index.html`) để xuất ngay file `.apk`.
