# TEN TIDES — Mô tả dự án game co-op 3D

Sep 25, 2026 · @ngo hai

## Tóm tắt

TEN TIDES (tên tạm) là game co-op 3D cho 2–6 người, mỗi ván khoảng 45–60 phút. Cả nhóm chuẩn bị hành trang rồi sống sót 10 ngày trên một hòn đảo có rừng dừa, hang động, hồ nước và một ngọn núi lửa đang thức giấc. Cốt truyện do một bộ sinh truyện theo seed ghép riêng cho từng ván, dựa trên nhân vật, balo, nơi cả đội đặt chân tới và các lần tung xúc xắc.

**Câu hỏi cốt lõi của game:** *Chúng ta mang theo gì — và ai trong chúng ta thật sự đáng tin?*

**Bốn điểm khác biệt**

- **Balo là lời khai.** Mỗi món đồ vừa là tài nguyên, vừa là tín hiệu để bộ sinh truyện dựng cảnh. Mang dây thừng thì sẽ có vách đá để leo; mang rượu thì sẽ có một đêm say xỉn.
- **Một hòn đảo, trăm bí mật.** Map 3D được thiết kế tay, nhưng vị trí kho báu, tài nguyên và hang nào mở được xáo lại mỗi ván. Khắp đảo rải easter egg cho người thích lục lọi.
- **Bộ sinh kể chuyện, engine làm trọng tài.** Luật, xác suất và kết quả do engine quyết định; bộ sinh truyện chỉ ghép lời kể từ thư viện hơn 100 yếu tố viết sẵn, theo seed của ván. Nhờ vậy game công bằng, cân bằng được và kiểm thử được.
- **Bạn bè có thể là kẻ thù.** Từ 4 người trở lên, một người có thể mang vai bí mật. Ai vừa đi một mình vào hang, và vì sao quay ra tay không?

Tham chiếu thể loại: xếp đồ kiểu *Backpack Hero*, khám phá đảo co-op 3D kiểu *Raft* hay *Sons of the Forest* nhưng tươi sáng hơn, vai ẩn kiểu *Werewolf / Among Us*, truyện sinh theo thủ tục kiểu *RimWorld* hay *Caves of Qud*. TEN TIDES gộp bốn thứ đó thành một ván chơi cho nhóm bạn.

## Hòn đảo 3D

Toàn bộ game diễn ra trên một hòn đảo 3D, góc nhìn thứ ba, phong cách low-poly màu sắc tươi. Map được thiết kế tay và cố định, nhưng mỗi ván seed xáo lại những thứ quan trọng nhất, nên người thuộc map vẫn không đoán trước được ván sau.

**Bốn vùng trên đảo**

| Vùng | Tài nguyên | Nguy hiểm | Đồ nên mang | Sự kiện tiêu biểu |
| --- | --- | --- | --- | --- |
| Bãi biển & rừng dừa | Dừa (vừa ăn vừa uống), gỗ trôi dạt; nơi dựng trại và neo thuyền | Dừa rơi trúng đầu, thủy triều lên nhanh | Dao rựa | Đồ trôi dạt vào bờ, dấu chân lạ trên cát |
| Hồ nước ngọt | Nước uống, cá | Đỉa, nước bẩn gây bệnh, đuối nước | Bình nước, dây thừng | Lặn xuống đáy tìm đồ, bóng người bên kia hồ lúc sương mù |
| Hang động | Manh mối kho báu, khoáng vật | Tối, lạc đường, sập hang, dơi | Đèn dầu, dây thừng | Tranh khắc cổ, đường hầm chỉ mở vào vài ngày |
| Núi lửa | Manh mối cuối cùng, đá obsidian | Khí độc, đá lăn, dung nham | Bộ sơ cứu, dây thừng | Mặt đất rung, lối đi mới mở ra sau động đất |

**Mỗi ván xáo lại gì (theo seed)**

- Vị trí kho báu, chọn từ 6–8 điểm ứng viên rải khắp đảo.
- Chỗ có dừa, cá, đồ trôi dạt; hang nào mở, hang nào sập.
- Thời tiết từng ngày và ngày núi lửa bắt đầu thức giấc. Thời tiết hiện ngay trên đảo: mây dày mỏng, mưa, bão có gió giật và sấm chớp, sương mù che tầm nhìn, động đất rung từng đợt.
- Biến cố ngày 5 và những thẻ sự kiện nối tiếp của nó.
- Điểm hẹn của băng cướp biển và vịnh nhỏ nơi kẻ lừa đảo hẹn giao dịch.

**Đảo có thể giết người.** Hồ dung nham giữa miệng núi lửa: rơi xuống là chết ngay, không ai cứu được. Đống lửa trại: giẫm vào thì bỏng và bị hất ra. Biển: lặn quá sâu mà hết hơi thì ngoi lên rất chậm; bơi khi kiệt sức hay đeo balo quá nặng thì chìm dần, phải đạp nước mới nổi. Lời kể lúc hoàng hôn và biên niên sử kể đúng người đó chết vì đâu.

**Âm thanh kể chuyện cùng hình ảnh.** Sóng to dần khi ra gần biển, gió rít trên núi, dế kêu khi đêm xuống, mưa rào, sấm tới sau chớp vài giây, lửa trại lách tách khi về gần trại, dung nham sôi ùng ục khi leo gần miệng núi, xuống nước thì mọi thứ ù đi. Nhạc nền tự sinh từ vài thang âm: sáng sủa ban ngày, trầm lại lúc hoàng hôn, buồn ban đêm, căng khi núi lửa sắp phun hay bão tới. Tất cả tổng hợp ngay trong trình duyệt, không có file âm thanh nào.

**Núi lửa là đồng hồ đếm ngược.** Mức hoạt động của núi lửa tăng dần theo ngày, và hết ngày 10 thì phun trào. Ai chưa lên thuyền rời đảo sẽ kẹt lại, nên giới hạn 10 ngày có lý do nằm ngay trong thế giới game.

**Easter egg.** Khoảng 15–20 điểm bí mật rải khắp đảo, không cần để thắng. Phần thưởng là mẩu truyện, trang phục, thành tựu hoặc một lợi thế nhỏ, để game không biến thành "phải tra wiki mới chơi được".

- Một cây dừa mọc ngang vách đá; leo tới nơi sẽ thấy một trái dừa vàng.
- Xác một con tàu cổ dưới đáy hồ, chỉ lộ ra vào ngày hồ cạn nước.
- Căn phòng sau thác nước trong hang, trên vách khắc tên các đoàn thám hiểm từ những ván trước của chính nhóm bạn.
- Dấu chân khổng lồ trên sườn núi lửa, dẫn tới một chỗ chẳng có gì.
- Một chai thư dạt vào bờ vào đúng một ngày ngẫu nhiên, lá thư do bộ sinh truyện ghép dựa trên diễn biến ván đó.

Easter egg tìm được sẽ được ghi vào sổ sự thật, để bộ sinh truyện nhắc tới trong lời kể và trong biên niên sử cuối ván.

**Thế giới quanh đảo sinh theo seed.** Đảo chính giữ nguyên để người thuộc map vẫn có lợi thế; mọi thứ quanh nó do seed bản đồ quyết định, cùng seed là cùng thế giới trên mọi máy:

- Vùng biển 480x480 m với 4–6 đảo nhỏ (cồn cát, đảo rừng, đảo đá, đảo cát đen, đảo vòng có vụng nước), rạn san hô để lặn, đáy biển sâu dần ra khơi. Bơi và lặn được; nín thở lâu hay mau tuỳ Thể lực, hết hơi thì đuối nước.
- 2–3 hang động và 1–2 hầm mỏ (khung gỗ chống lò, đường ray, xe goòng, mạch quặng). Càng vào sâu càng tối; Gan dạ cao hoặc mang đèn dầu, đuốc thì đỡ tối.
- Easter egg và điểm bất thường (vòng nấm phát sáng, đá lơ lửng, tảng đá thì thầm…); kết quả của điểm bất thường tốt hay xấu đã định sẵn theo seed.
- Bẫy (hố chông, thòng lọng, cát lún, đá lở, khe khí độc…) rải theo seed bí mật của server, chỉ lộ khi có người sập.
- Sinh vật từ thân thiện, trung tính tới nguy hiểm, từ quen thuộc, lạ tới biến dị. Sinh vật lạ và biến dị xuất hiện muộn dần khi núi lửa thức.

Chủ phòng nhập hoặc gieo lại seed bản đồ ở sảnh chờ, để nhóm chơi lại một bản đồ hay hoặc khoe seed với nhóm khác. Mọi chạm trán (bị cắn, sập bẫy, nhặt easter egg) đi qua engine luật như một hành động, nên ván vẫn phát lại được từ seed và log.

**Tay chân và đánh nhau.** Đồ trong balo không chỉ để cộng điểm: cầm món nào lên tay là dùng được món đó ngay trên đảo.

- Cầm để đánh (dao rựa, rìu, giáo, búa…), bắn (súng kíp, ná), ném (thuốc súng nổ, dừa, túi mực làm mù), ăn uống (bánh quy, rượu rum làm chóng mặt, thịt sống thì đau bụng), trồng cây, đặt xuống đất cho người khác nhặt. Tay không thì đấm, và chặt cây rất chậm.
- Đánh trúng là phải đã mắt và buồn cười: chữ tượng thanh to (BỤP!, XOẸT!, ĐOÀNG!, BONG!), số Máu mất, mảnh vụn văng, rung màn hình, bị đánh thì bật lùi. Ba trạng thái: choáng (đứng hình, sao bay quanh đầu), chóng mặt (đi loạng choạng, màn hình nghiêng), mù (tối sầm).
- Kẻ phản bội có thêm một đòn kết liễu: đứng sát ai đó là hạ gục ngay, mỗi ngày một lần. Mọi người chỉ thấy người đó gục ngã; ai ra tay chỉ lộ ở màn lật bài.
- Leo cây để nhìn xa hay trốn thú dữ (nhân vật ôm thân cây, chổng mông ra ngoài, trèo thì mông lắc qua lắc lại). Cây chặt được, rơi gỗ, dừa, cây giống; cây giống trồng xuống sẽ lớn dần. Đang leo mà có người đốn cây thì té, mất Máu theo độ cao.
- Thú vật đánh chết được và rơi đồ. Có con leo lên cây, bay vút lên hay lặn sâu để trốn; thú dữ bị đánh thì thù dai, đuổi theo. Giết thú hiền thì mất Tinh thần. Bơi ra khơi lâu có thể có cá mập tới.
- Gỗ và da dựng được chòi lá, nhà sàn, hàng rào quanh lửa trại; nhà đủ chỗ cho mọi người ở trại thì đêm đó cả đội đỡ mất Tinh thần. Lửa trại nhổ lên mang đi được: đặt lửa trại ở đâu là cả khu nhà dời theo tới đó (tới hoàng hôn mà chưa ai đặt thì lửa trại tự dựng lại chỗ người vác).

## Trải nghiệm một ván chơi

Một ván gồm 3 bước chuẩn bị rồi tối đa 10 vòng ngày. Mục tiêu thiết kế là 4–5 phút mỗi ngày, trong đó khoảng 3 phút khám phá đảo tự do, để cả ván gói trong 45–60 phút.

&#91;embedded content: vòng lặp một ván · 3 bước chuẩn bị, 5 pha mỗi ngày\]

Ván kết thúc sớm nếu cả đội chết hoặc phe phản bội đạt mục tiêu trước ngày 10.

| Pha | Chuyện gì xảy ra | Thời lượng mục tiêu |
| --- | --- | --- |
| Sảnh chờ | Chủ phòng tạo phòng, mời bạn bằng mã; chọn độ khó | 1 phút |
| Tạo nhân vật | Chia điểm thuộc tính, chọn xuất thân, tật xấu và ngoại hình 3D | 2 phút |
| Xếp balo | Mua đồ bằng ngân sách, xếp vào lưới 16x16, có đồng hồ đếm ngược | 4 phút |
| Bình minh | Tại trại: bộ sinh truyện tả thời tiết, núi lửa, tình trạng từng người; cả đội chia nhau đi đâu | 30 giây |
| Khám phá 3D | Tự do di chuyển trên đảo: hái dừa, lấy nước, tìm manh mối, săn easter egg | Khoảng 3 phút, có đồng hồ mặt trời |
| Điểm sự kiện | Chạm vào điểm sự kiện trên map thì thẻ mở ra; chỉ người đang đứng đó tham gia, xúc xắc công khai | 20–40 giây mỗi lần, nằm trong giờ khám phá |
| Hoàng hôn | Mọi người về trại trước khi trời tối; ai ở ngoài phải ngủ ngoài, bộ sinh truyện kể lại cả ngày | 30 giây |
| Đêm | Chat quanh đống lửa, bỏ phiếu chia khẩu phần hoặc nghi ai; vai ẩn hành động bí mật | 60 giây |

**Nguyên tắc nhịp độ:** ban ngày chạy thời gian thực, không theo lượt. Sự kiện ở một điểm chỉ dừng những người đang đứng đó, người khác vẫn đi tiếp. Vì vậy chia nhóm hay đi một mình là một quyết định chiến thuật — và là cơ hội cho kẻ phản bội.

Ai không về trại kịp lúc trời tối sẽ phải ngủ ngoài và gặp sự kiện đêm riêng. Người rời ván giữa chừng thì bot tạm điều khiển nhân vật, ở yên trong trại.

## Tạo nhân vật

Mỗi nhân vật gồm 5 thuộc tính, 1 xuất thân, 1 tật xấu và một dòng tự mô tả. Thuộc tính quyết định xác suất; xuất thân và tật xấu là móc câu để bộ sinh truyện viết lời kể riêng cho người đó.

**Thuộc tính:** chia 15 điểm, mỗi thuộc tính từ 1 đến 5 (con số khởi điểm, sẽ cân bằng qua playtest).

| Thuộc tính | Tác dụng cơ chế | Loại cảnh hay gặp |
| --- | --- | --- |
| Thể lực | Tăng giới hạn trọng lượng balo và máu tối đa; kiểm tra leo, bơi, vác | Vượt địa hình, đánh tay đôi |
| Khéo léo | Kiểm tra lén lút, trộm đồ, sửa chữa, câu cá | Đột nhập, mở khóa, thoát bẫy |
| Trí tuệ | Đọc bản đồ, giải đố, phát hiện đồ giả; đẩy nhanh tiến độ tìm kho báu | Mật mã, cổ vật, bản đồ |
| Duyên | Mặc cả với NPC, thuyết phục khi bỏ phiếu | Thương nhân, dân đảo, đàm phán với cướp biển |
| Gan dạ | Chống hoảng loạn, giữ tinh thần, chịu đói | Đêm bão, tra hỏi, chuyện ma |

**Thuộc tính hiện ra trong chuyển động 3D.** Thể lực quyết định thanh sức bền khi chạy, bơi và leo; Gan dạ quyết định màn hình có tối và méo đi khi ở sâu trong hang. Người chơi cảm nhận nhân vật qua tay điều khiển, không chỉ qua con số.

**Chỉ số sinh tồn** tính từ thuộc tính và thay đổi mỗi ngày: Máu, No, Tinh thần. Máu về 0 là chết; No hoặc Tinh thần về 0 gây trạng thái xấu như kiệt sức, hoảng loạn.

**Xuất thân** (chọn 1): mỗi xuất thân cho 1 món đồ khởi đầu và 1 kỹ năng riêng.

- Thủy thủ già — bơi lặn giỏi, cộng điểm ở hồ và bờ biển
- Y sĩ bỏ nghề — chữa trị hiệu quả gấp đôi
- Thợ săn — săn bắn ra thêm thức ăn
- Nhà khảo cổ — cộng điểm Trí tuệ với cổ vật và bản đồ
- Con nhà giàu — thêm ngân sách mua đồ nhưng khởi đầu kém Gan dạ
- Tay cờ bạc — được tung lại xúc xắc 1 lần mỗi ngày
- Thợ mộc — ban đêm sửa thuyền gấp đôi
- Người dẫn đường — cộng điểm trong hang và trên núi lửa

**Tật xấu** (bắt buộc, đổi lấy +2 điểm thuộc tính): sợ độ cao, sợ bóng tối, tham lam, nghiện rượu, nói dối thành tật, hậu đậu. Tật xấu kích hoạt sự kiện cá nhân và là nguyên liệu drama tốt nhất cho bộ sinh truyện.

**Dòng tự mô tả** tối đa 140 ký tự, ví dụ "trốn nợ, đi tìm kho báu để về chuộc nhà". Bộ sinh truyện chèn dòng này vào lời kể riêng và biên niên sử, nhưng nó chỉ là dữ liệu, không bao giờ được thay đổi luật chơi.

## Balo 16x16

Balo là lưới 16x16 (256 ô); mỗi món đồ là một khối hình chiếm nhiều ô và xoay được, giống xếp gạch. Ba giới hạn chạy cùng lúc — ô trống, trọng lượng, ngân sách — nên xếp balo là một câu đố có đánh đổi thật, không chỉ là nhét cho đầy.

**Ba giới hạn**

- **Không gian:** 256 ô, nhưng đồ lớn như lều, thùng nước ngọt, xuồng gấp chiếm 16–24 ô mỗi món.
- **Trọng lượng:** mức tối đa tăng theo Thể lực; vượt mức thì nhân vật đi chậm hơn, leo kém hơn và mỗi ngày mất thêm No.
- **Ngân sách:** mỗi người có số xu cố định. Cửa hàng mỗi ván bày một bộ đồ ngẫu nhiên, nên không có cách xếp "chuẩn" nào dùng mãi được.

**Cơ chế riêng của balo**

- **Đặt cạnh nhau tạo hiệu ứng:** đèn dầu cạnh bản đồ cho phép đọc bản đồ ban đêm; thuốc súng cạnh diêm có xác suất phát nổ khi bị ngã.
- **Ngăn bí mật 4x4:** đồ trong ngăn này không lộ khi bị lục soát thông thường. Đây là nơi kẻ phản bội giấu hàng.
- **Đồ hao mòn:** thức ăn tươi hỏng sau vài ngày, dây thừng và vũ khí có độ bền.
- **Balo thay đổi trong hành trình:** đồ có thể mất vì bị cướp, rơi xuống nước, hoặc bị đồng đội lấy trộm trong đêm.
- **Trao đổi:** người chơi chuyển đồ cho nhau trong pha Hành động; người nhận phải còn chỗ trống.

**Đồ lớn hiện trên người.** Xẻng, súng, dây thừng nhìn thấy được trên lưng nhân vật trong 3D, nên đồng đội liếc qua là biết ai đang mang gì. Đồ trong ngăn bí mật thì không hiện.

**Mỗi món đồ là dữ liệu, không phải code.** Thẻ (tag) là cầu nối giữa engine và bộ sinh truyện: engine dùng thẻ để lọc sự kiện hợp lệ, bộ sinh dùng thẻ và móc câu để viết cảnh. Thêm đồ mới chỉ cần khai báo thêm một dòng dữ liệu.

| Đồ (ví dụ) | Kích thước | Nặng | Thẻ | Móc câu cho truyện |
| --- | --- | --- | --- | --- |
| Dây thừng | 2x3 ô | 2 kg | công cụ, leo | Vách đá, hang sâu, trói tù binh |
| Dao rựa | 1x4 ô | 1,5 kg | công cụ, chặt | Chặt dừa, mở lối qua rừng rậm |
| Đèn dầu | 2x2 ô | 1 kg | ánh sáng, dễ cháy | Cần để vào sâu trong hang |
| Bình nước | 2x3 ô | 1,5 kg | nước | Múc ở hồ; nước bẩn nếu chưa đun |
| Bản đồ cũ | 2x2 ô | 0,2 kg | manh mối | Có thể là bản đồ giả |
| Lương khô | 1x2 ô | 0,5 kg | thức ăn | Hỏng sau 3 ngày |
| Súng kíp | 1x5 ô | 3 kg | vũ khí, gây ồn | Tiếng súng kéo thú dữ hoặc cướp biển tới |
| Bộ sơ cứu | 3x2 ô | 1 kg | y tế | Cứu người sắp chết |
| Rượu rum | 1x3 ô | 1 kg | xa xỉ, trao đổi | Đổi tin tức với người lạ, hoặc một đêm say xỉn |
| Xẻng | 1x6 ô | 2,5 kg | công cụ, đào | Cần để đào kho báu |
| Bùa hộ mệnh | 1x1 ô | 0,1 kg | bí ẩn | Bộ sinh truyện được tự do diễn giải |

## Vòng lặp 10 ngày & hệ thống sự kiện

10 ngày chia thành 3 hồi với độ căng tăng dần. Mỗi sáng engine đặt thẻ sự kiện vào các điểm trên map, dựa trên hồi, vùng, trạng thái đội và đồ trong balo. Mọi phép random dùng seed của ván nên ván nào cũng tái hiện lại được.

| Hồi | Ngày | Cảm xúc mục tiêu | Sự kiện ưu tiên |
| --- | --- | --- | --- |
| Khởi hành | 1–3 | Làm quen đảo, gắn kết, tật xấu bắt đầu lộ | Dựng trại, hái dừa, tìm nguồn nước, đồ trôi dạt vào bờ |
| Biến cố | 4–7 | Thiếu thốn, nghi ngờ nhau | Bão, sập hang, đồ biến mất khỏi trại, manh mối kho báu; ngày 5 luôn có một cú twist lớn |
| Cao trào | 8–10 | Chạy đua với núi lửa, lật mặt | Động đất mở lối mới, bẫy canh kho báu, vai ẩn ra tay, tranh nhau lên thuyền |

**Thẻ sự kiện là đơn vị nội dung nhỏ nhất.** Mỗi thẻ khai báo loại điểm trên map nó được đặt vào, điều kiện xuất hiện, 2–4 lựa chọn, phép kiểm tra và kết quả. Kết quả chỉ là thay đổi trạng thái (chỉ số, đồ, cờ, trạng thái cảnh 3D); lời văn mẫu gắn theo thẻ, và bộ sinh truyện kể lại lúc hoàng hôn.

```json
{
  "id": "cave_collapse_01",
  "acts": [2, 3],
  "anchorType": "cave_tunnel",
  "requires": { "zone": "cave", "weather": ["storm", "quake"] },
  "choices": [
    {
      "id": "dig_out",
      "check": { "stat": "strength", "dc": 12, "itemBonus": { "shovel": 3 } },
      "onSuccess": { "stamina": -10 },
      "onFail": { "hp": -20, "loseRandomItem": 1 }
    },
    {
      "id": "find_another_way",
      "check": { "stat": "intellect", "dc": 11, "itemBonus": { "lantern": 2 } },
      "onSuccess": { "setFlag": "found_hidden_tunnel" },
      "onFail": { "morale": -15, "lostUntilDusk": true }
    }
  ],
  "sceneState": { "onAny": "cave_tunnel_collapsed" },
  "narrativeHooks": ["bụi đá rơi lả tả", "tiếng vọng tắt ngấm"]
}
```

**Biến cố ngày 5 là cơ chế, không chỉ là lời kể.** Lúc bắt đầu ván, engine chọn một trong 8 biến cố và giữ bí mật; bình minh ngày 5 nó xảy ra với hệ quả thật (mất tiến độ kho báu, thuyền hư, núi lửa tỉnh sớm...) và dựng một cờ mở khoá những thẻ sự kiện nối tiếp chỉ có trong biến cố đó (gặp ông lão trong phế tích, gỡ cơ quan dưới tro nóng, trao đổi với đoàn thám hiểm kia...). Bộ sinh truyện dựng cả cốt truyện của ván quanh đúng biến cố engine đã chọn, nên điều được kể và điều xảy ra luôn khớp nhau. Thẻ cũng nối với nhau qua cờ: đọc được nhật ký thuyền trưởng ở xác tàu thì mới mở được cửa đá trong phế tích.

**Ngủ ngoài trại là một sự kiện.** Ai không kịp về trại gặp một chuyện trong đêm hợp với thời tiết (thú rình, mưa dầm, thủy triều lên, tiếng thì thầm, trời đầy sao...), có phép kiểm tra như thẻ sự kiện; lều, đuốc, súng, la bàn giúp được. Sáng ra cả đoàn nghe kể, riêng người đó được kể kỹ hơn.

**Đạo diễn độ căng.** Engine giữ một đường cong độ căng mục tiêu theo ngày, có nhịp nghỉ xen kẽ. Đội đang quá khỏe thì rút thẻ khó hơn; đội sắp chết cả loạt ở hồi 1 thì rút thẻ hồi phục — cùng ý tưởng với AI Director trong Left 4 Dead.

**Tài nguyên chung của đội:** Tiến độ kho báu (0–100), Mức hoạt động núi lửa, Độ bền thuyền, Lương thực chung. Tiến độ tăng nhờ manh mối, đọc đúng bản đồ và khám phá đúng vùng, và nó thu hẹp dần các điểm ứng viên trên map. Đạt 100 là biết chính xác chỗ đào, nhưng vẫn cần người mang xẻng tới đó và một chiếc thuyền đủ tốt để rời đảo.

**Random phải công bằng và nhìn thấy được.** Mỗi lần tung xúc xắc hiện công khai kèm các khoản cộng: thuộc tính, đồ, trạng thái. Người thua phải hiểu vì sao mình thua, nếu không random sẽ bị cảm nhận là game "chơi ép".

## Bộ sinh cốt truyện

Cốt truyện không do mô hình AI viết. Game dùng một thuật toán sinh truyện: một thư viện hơn 100 yếu tố truyện viết sẵn, và một bộ sinh dùng seed của ván để chọn và trộn chúng. Cùng seed luôn ra cùng một câu chuyện, nên ván nào cũng phát lại và kiểm thử được. Không có chi phí mỗi ván, không có độ trễ chờ mô hình, và không ai "dụ" được người kể.

Nguyên tắc số một vẫn giữ nguyên: engine quyết định, bộ sinh chỉ kể. Bộ sinh không bao giờ sửa chỉ số, sinh đồ hay định đoạt sống chết; mọi câu nó viết đều dựa trên sự thật engine đã ghi.

**Thư viện yếu tố truyện.** Hơn 100 yếu tố, lưu thành dữ liệu JSON có schema, chia 12 nhóm:

| Nhóm | Ví dụ | Dùng khi nào |
| --- | --- | --- |
| Người giấu kho báu | thuyền trưởng Hắc Triều, vị tu sĩ bị lưu đày, nhà thám hiểm mất tích năm 1932 | Truyền thuyết của ván, lời kết |
| Động cơ | để trả thù, để chôn cùng người mình yêu, để phong ấn một lời nguyền | Truyền thuyết (phải hợp với người giấu) |
| Kho báu là gì | pho tượng ngọc bích, túi ngọc trai đen, tấm bản đồ dẫn tới kho báu lớn hơn | Truyền thuyết, lúc đào được, lời kết |
| Bí mật của đảo | đáy hồ là một ngôi làng bị nhấn chìm, hòn đảo từng là trại giam | Ngày đầu |
| Nhân vật phụ | bà thầy bói mù, con vẹt biết nói, người canh hải đăng đã tắt | Bình minh ngày 2 và 6 |
| Điềm báo | trăng đỏ, cua đỏ bò kín bãi cát, tiếng trống từ núi lửa | Đầu mỗi hồi |
| Twist ngày 5 | có người đã tới trước, người giấu vẫn còn sống | Luôn ở bình minh ngày 5 |
| Vật chứng | cuốn nhật ký rách, đồng xu khắc hình con rắn | Bình minh ngày 3 và 7 |
| Không khí từng vùng | tiếng nước nhỏ giọt trong hang, mùi lưu huỳnh trên núi | Hoàng hôn, theo vùng cả đoàn đã tới |
| Thời tiết | câu mở đầu cho nắng, mưa, sương, bão, động đất | Mỗi bình minh |
| Lời kết | mỗi kết thúc một lời kết, cộng lời kết chung | Biên niên sử |
| Quan hệ giữa hai người chơi | từng yêu nhau, còn nợ tiền, học chung lớp | Lời kể riêng ngày đầu |

Mỗi yếu tố có thẻ và điều kiện (hồi, vùng, thời tiết, kết thúc, thẻ bắt buộc của yếu tố đi kèm), nên tổ hợp nào ghép ra cũng hợp lý. Thêm yếu tố mới chỉ cần thêm một dòng JSON.

**Cách bộ sinh làm việc**

1. **Lúc bắt đầu ván**, seed chọn "cốt truyện của ván": người giấu, động cơ hợp với người đó, kho báu, bí mật của đảo, hai nhân vật phụ, ba điềm báo, một twist, hai vật chứng và vài cặp quan hệ giữa người chơi. Với thư viện hiện tại đã có hàng chục nghìn tổ hợp khác nhau.
2. **Mỗi bình minh**, bộ sinh kể: thời tiết, núi lửa, điềm báo hoặc nhân vật phụ hay vật chứng của ngày, twist ngày 5, chuyện đêm qua (ai bị trói, ăn uống ra sao, sự cố gì), rồi ai đang đau, đói hay bị trói.
3. **Mỗi hoàng hôn**, bộ sinh kể lại cả ngày từ nhật ký xúc xắc: ai gặp chuyện gì ở đâu, thành hay bại, nhờ món đồ nào, ai đào được kho báu, ai gục, ai không kịp về trại.
4. **Mỗi người có lời kể riêng**, viết ở ngôi "bạn", dựa trên dòng tự mô tả, xuất thân, tật xấu, quan hệ với người khác và vai của mình. Server chỉ gửi phần này cho đúng người đó.
5. **Cuối ván**, bộ sinh viết biên niên sử một trang: tên đoàn, truyền thuyết, thành viên, khoảnh khắc đáng nhớ, kẻ phản bội là ai, và lời kết.

**Trang nhật ký trên đảo.** Mỗi ngày có một trang nhật ký của người xưa nằm ở một chỗ theo seed bản đồ, mấy ngày đầu gần trại rồi xa dần (lên đồi, vào hang, ra đảo nhỏ, lên núi lửa). Nhặt được thì thêm manh mối kho báu và đọc được một mảnh cốt truyện của ván (người giấu, động cơ, vật chứng, bí mật của đảo...), trang đó lưu vào sổ truyện của người nhặt.

**Danh hiệu cuối ván.** Màn lật bài và biên niên sử trao danh hiệu cho những việc làm đáng nhớ trên đảo (Thợ săn, Tiều phu, Bạn thân của trọng lực, Nam châm hút bẫy, Người nuôi cả trại...), mỗi người một danh hiệu, không ảnh hưởng thắng thua.

**Mẫu câu viết trọn câu.** Mỗi câu trong thư viện và trong bộ mẫu câu là một câu tiếng Việt hoàn chỉnh, chỉ chừa chỗ trống cho tên người, tên đồ và tên nơi. Nhờ vậy câu ghép ra luôn đúng ngữ pháp. Mỗi lời kể dùng một luồng random riêng (seed của ván + loại lời kể + ngày + người), nên lời kể không phụ thuộc thứ tự tính toán. Test tự động chạy hàng trăm ván để bảo đảm không câu nào sót chỗ trống, không câu nào lộ vai ẩn.

**Đầu vào của người chơi chỉ là dữ liệu.** Tên và dòng tự mô tả chỉ được chèn vào đúng chỗ trống của mẫu câu, bị cắt độ dài, và không bao giờ ảnh hưởng tới luật.

**Bộ sinh và thế giới 3D.** Lời kể hiện ngay trong trò chơi: bản kể bình minh trên đầu màn hình, bản kể hoàng hôn khi cả trại ngồi quanh đống lửa, sổ truyện (phím J) để đọc lại, và biên niên sử có nút sao chép để chia sẻ. Sau này có thể gắn thêm lời thoại của nhân vật phụ và trang nhật ký nhặt được vào đúng điểm trên map.

## Vai trò bí mật & các kết thúc

Kết thúc do engine xác định từ trạng thái cuối ván; bộ sinh truyện chỉ viết lời kết. Từ 4 người trở lên, mỗi ván có thể có 0 hoặc 1 kẻ phản bội — chính khả năng "có thể chẳng có ai" giữ cho sự nghi ngờ luôn sống.

**Vai bí mật** (chia ngẫu nhiên lúc bắt đầu, chỉ người nhận biết)

| Vai | Phe | Mục tiêu bí mật | Năng lực |
| --- | --- | --- | --- |
| Cướp biển nằm vùng | Phản bội | Đưa đoàn tới điểm hẹn của băng cướp, hoặc làm độ bền thuyền về 0 | Mỗi đêm được phá hoại hoặc gửi tín hiệu cho băng cướp |
| Kẻ lừa đảo | Phản bội | Gom đủ lòng tin và đồ giá trị, rồi dụ cả đoàn tới điểm giao dịch để bán đứng | Làm giả manh mối, mua chuộc NPC |
| Y tá | Phe đội (ẩn) | Giữ cho nhiều người sống nhất tới cuối ván | Mỗi đêm cứu 1 người khỏi chết; lộ thân phận thì thành mục tiêu của kẻ phản bội |
| Người thường | Phe đội | Tìm kho báu và sống sót | Không có |

Mỗi đêm cả đội có thể bỏ phiếu trói một người bị nghi. Trói đúng kẻ phản bội thì hắn mất năng lực; trói nhầm thì đội mất một tay khỏe — đó là cái giá của sự nghi ngờ.

**Các kết thúc**

| Kết thúc | Điều kiện kích hoạt | Ai thắng |
| --- | --- | --- |
| Kho báu về tay | Đào được kho báu và lên thuyền rời đảo trước khi núi lửa phun, còn ít nhất 1 người sống | Phe đội |
| Kho báu nhuốm máu | Mang được kho báu đi nhưng có người chết, bị trói oan hoặc bị bỏ lại trên đảo | Phe đội, thắng đắng |
| Lật mặt kẻ phản bội | Trói đúng kẻ phản bội trước khi hắn đạt mục tiêu, rồi vẫn mang được kho báu đi | Phe đội, có thưởng |
| Kẻ sống sót duy nhất | Chỉ còn 1 người lên được thuyền cùng kho báu | Người đó |
| Tay trắng trở về | Rời đảo kịp lúc nhưng không có kho báu | Không ai |
| Chôn vùi cùng hòn đảo | Núi lửa phun khi cả đội còn trên đảo, hoặc máu của mọi người về 0 | Không ai |
| Cướp biển chiếm thuyền | Cướp biển nằm vùng đạt mục tiêu | Cướp biển |
| Bị bán đứng | Kẻ lừa đảo đưa được cả đoàn tới vịnh giao dịch | Kẻ lừa đảo |

**Màn lật bài cuối ván** công khai vai của mọi người, ngăn bí mật của từng balo và những lần tung xúc xắc quyết định. Khoảnh khắc "hóa ra là mày!" là phần thưởng cảm xúc lớn nhất của cả ván.

**Biên niên sử** là bản kể lại một trang do bộ sinh truyện ghép, kèm nút sao chép (sau này thêm thẻ ảnh) để chia sẻ: tên đoàn, kết thúc, khoảnh khắc đáng nhớ nhất, và ai là kẻ phản bội. Đây là vòng lặp lan truyền chính: người chơi đăng lên mạng, bạn bè tò mò và vào chơi.

## Kiến trúc kỹ thuật

TEN TIDES chạy trên trình duyệt: gửi link là cả nhóm vào chơi, không cần cài đặt. Đồ họa low-poly nhẹ là chủ đích, không phải thỏa hiệp. Toàn bộ hệ thống viết bằng TypeScript, nên engine luật viết một lần và dùng chung cho cả client lẫn server.

Hệ thống vẫn có hai mặt phẳng: thời gian thực (di chuyển, vật lý, tương tác trên map) và game master (luật, bí mật, kể chuyện). Nhưng không người chơi nào làm host: cả hai mặt phẳng chạy trên một server có thẩm quyền, tách thành hai module riêng trong cùng một process.

**Vì sao chọn web thay vì Unity hay Godot**

| Lựa chọn | Điểm mạnh | Điểm yếu | Quyết định |
| --- | --- | --- | --- |
| Web: three.js / React Three Fiber | Gửi link là chơi; một ngôn ngữ cho client, server và engine luật; build và deploy nhanh | Giới hạn hiệu năng và đồ họa; phần mạng phải tự ráp nhiều hơn | **Chọn** |
| Unity (C#) | Kho asset và thư viện mạng lớn; build được PC lẫn mobile | Nặng, bắt người chơi cài đặt; cần đọc kỹ điều khoản license | Không chọn |
| Godot 4 | Mã nguồn mở, miễn phí, nhẹ | Kho asset và công cụ mạng nhỏ hơn | Phương án dự phòng nếu sau này cần đồ họa hoặc vật lý nặng hơn nhiều |

Nếu sau này phát hành Steam, bản web được bọc bằng Tauri hoặc Electron, không phải viết lại.

**Các thành phần hệ thống**

| Thành phần | Công nghệ | Trách nhiệm |
| --- | --- | --- |
| Client 3D | three.js + React Three Fiber + drei, build bằng Vite | Render đảo, camera góc nhìn thứ ba, hoạt ảnh nhân vật, hiệu ứng xúc xắc |
| Vật lý & di chuyển | Rapier (`@react-three/rapier`), character controller | Chạy, leo, bơi, va chạm với địa hình |
| UI 2D | React DOM phủ lên canvas 3D | Balo 16x16 kéo thả, thẻ sự kiện, chat quanh đống lửa, bỏ phiếu |
| Mạng thời gian thực | Colyseus (Node), server có thẩm quyền, tick khoảng 20Hz | Đồng bộ vị trí, hoạt ảnh, đồ nằm trên map; lọc trạng thái theo từng người chơi |
| Game master | Module TypeScript trong cùng server | Luật, bí mật, rút thẻ, đạo diễn độ căng, kết thúc; gửi trạng thái riêng cho từng người |
| Rules engine | Gói TypeScript thuần dùng chung, PRNG có seed | Hàm thuần (trạng thái, hành động, seed) → trạng thái mới; không phụ thuộc 3D, mạng hay lời kể |
| Nội dung | JSON có version, kiểm tra bằng zod | Thẻ, đồ, xuất thân, tật xấu, yếu tố truyện, mẫu câu, danh mục trạng thái cảnh tại từng điểm |
| Bộ sinh truyện | Gói TypeScript thuần (`packages/story`), không gọi mô hình AI nào | Chọn cốt truyện theo seed, ghép lời kể bình minh, hoàng hôn, riêng từng người và biên niên sử từ sự thật trong ván |
| Lưu trữ | PostgreSQL + Drizzle | Event log từng ván, biên niên sử, tên các đoàn cho easter egg |
| Asset | glTF low-poly (Kenney, Quaternius, CC0), dựng map bằng Blender, nén bằng `gltf-transform` (meshopt) | Mô hình đảo, nhân vật, đồ vật |
| Deploy | Client tĩnh trên Cloudflare Pages; server Node trên Fly.io hoặc Railway | Một process phục vụ nhiều phòng |
| Test | Vitest; mô phỏng bot chạy thẳng trên rules engine | Kiểm thử luật, cân bằng tỷ lệ các kết thúc |

Code tổ chức thành một monorepo (pnpm workspaces): `client`, `server`, `rules`, `content`, `protocol`, `story`.

**Bốn quyết định kiến trúc đáng chú ý**

1. **Không ai làm host, bí mật không bao giờ rời server.** Server gửi cho mỗi người đúng phần trạng thái người đó được thấy (StateView của Colyseus). Vai ẩn, ngăn bí mật, lời kể riêng và vị trí kho báu không bao giờ tới máy người khác, nên mở DevTools cũng không biết ai là kẻ phản bội. Mô hình này cũng loại bỏ luôn rủi ro host thoát giữa ván.
2. **Server xác nhận mọi hành động có hệ quả.** Nhặt đồ, chạm điểm sự kiện, đào đất: client báo lên, server kiểm tra khoảng cách, thời điểm và đồ cần có rồi mới ghi nhận. Đào đúng chỗ hay không, chỉ server biết.
3. **Event sourcing cho phần game master.** Lưu seed và chuỗi hành động có hệ quả, không lưu từng bước di chuyển. Nhờ đó có replay để debug, xem lại ván, phân tích cân bằng, và khôi phục khi server khởi động lại.
4. **Engine luật là hàm thuần, có tính xác định.** Mọi random đi qua PRNG có seed. Có thể chạy mô phỏng hàng nghìn ván bằng bot, bỏ qua phần 3D và lời kể, để cân bằng tỷ lệ các kết thúc trước khi người thật chơi.

**Ngân sách đồ họa.** Mục tiêu 60fps trên laptop chỉ có GPU tích hợp và lần tải đầu dưới 30MB. Cách giữ: tô màu bằng vertex color và flat shading thay cho texture, một đèn directional với shadow map nhỏ, sương mù để giới hạn tầm nhìn, `InstancedMesh` cho cây dừa, đá và cỏ, tải asset từng vùng khi cần.

**Mở rộng.** Một phòng 6 người đồng bộ vị trí ở khoảng 20Hz là tải rất nhẹ, nên một máy chủ nhỏ chạy được nhiều phòng cùng lúc; game master chỉ xử lý vài chục hành động có hệ quả mỗi ngày trong game. Khi một server không đủ, thêm Redis để Colyseus chia phòng ra nhiều process. Lời kể do bộ sinh truyện ghép ngay trên server, gần như không tốn thời gian, nên không có chi phí nào tăng theo số ván.

## Phạm vi MVP & lộ trình

Làm prototype giấy trước khi viết code: câu hỏi "ván này có vui không" rẻ nhất khi trả lời bằng bảng tính và giấy cắt. Chuyển sang 3D làm phạm vi tăng rõ rệt vì art và level design thành chi phí lớn nhất, nên cần thêm một người làm art 3D hoặc dựa vào asset pack low-poly. Thời gian dưới đây ước tính cho 1–2 dev bán thời gian cộng một người làm art; mỗi giai đoạn chỉ mở khi qua cổng của giai đoạn trước.

| Giai đoạn | Phạm vi | Thời gian | Cổng để qua |
| --- | --- | --- | --- |
| 0. Prototype giấy | 30 thẻ sự kiện trên bảng tính, bản đồ đảo vẽ tay, balo cắt giấy, một người đóng vai người kể | 2 tuần | Nhóm test tự đòi chơi ván thứ hai |
| 1. Graybox 3D | Đảo dựng bằng khối xám với 4 vùng, 3 người di chuyển co-op, balo, vòng ngày đầy đủ, bộ sinh truyện kể bản chung | 8–10 tuần | 3 người chơi hết 10 ngày trong dưới 60 phút, không lỗi đồng bộ |
| 2. MVP | Đảo low-poly hoàn chỉnh, 4–6 người, vai ẩn, 40 món đồ, 60 thẻ gắn điểm trên map, 8 kết thúc, 10 easter egg, biên niên sử | 12–16 tuần | 30 ván test: không kết thúc nào chiếm quá 40%; người chơi không thấy lời kể lặp lại trong 3 ván liền |
| 3. Closed beta | Kết nối lại khi rớt mạng, bot thay người rời, tự khôi phục phòng khi server khởi động lại, analytics, kiểm duyệt nội dung | 6 tuần | Tỷ lệ nhóm chơi lại trong 7 ngày đạt mục tiêu đặt ra |
| 4. Mở rộng | Đảo mới, phát hành Steam, easter egg theo mùa, công cụ tạo thẻ cho cộng đồng | Liên tục | — |

**MVP cố ý bỏ qua:** tài khoản (vào bằng mã phòng), điều khiển cảm ứng cho mobile (chơi trên trình duyệt máy tính), voice chat, cửa hàng trả phí, đồ họa chi tiết (dùng low-poly và asset có sẵn).

## Rủi ro & câu hỏi mở

Với bản 3D, rủi ro lớn nhất là phạm vi: art và level design dễ nuốt hết thời gian trước khi biết game có vui hay không. Sau đó mới tới lời kể nhàm hoặc lặp, và random bị cảm nhận là bất công.

| Rủi ro | Tác động | Cách giảm |
| --- | --- | --- |
| Phạm vi 3D (art, level design, hoạt ảnh) vượt sức nhóm nhỏ | Trễ hạn, bỏ dở giữa chừng | Graybox trước, low-poly và asset có sẵn; chỉ một hòn đảo cho tới khi MVP chứng minh được là vui |
| Khám phá 3D làm ván dài hơn | Khó gom đủ nhóm cho một buổi | Giới hạn giờ ban ngày; cân nhắc lưu ván để chơi tiếp buổi sau |
| Server sập giữa ván hoặc người chơi gian lận | Mất ván hoặc lộ bí mật | Không ai làm host; bí mật không rời server; khôi phục ván từ event log; server xác nhận hành động có hệ quả |
| Lỗi đồng bộ mạng | Mỗi người thấy một kiểu | Dùng thư viện netcode có sẵn; server làm trọng tài cho mọi hành động có hệ quả |
| Lời kể lặp lại sau vài ván | Người chơi thấy "máy", mất hứng | Thư viện hơn 100 yếu tố và mở rộng dần; tổ hợp theo seed; ghi lại yếu tố nào hay lặp qua telemetry |
| Câu ghép sai ngữ pháp hoặc sót chỗ trống | Mất nhập vai | Mẫu câu viết trọn câu, chỉ chừa chỗ cho tên; test tự động chạy hàng trăm ván kiểm tra từng câu |
| Lời kể mâu thuẫn trạng thái (nhắc đồ đã mất, người đã chết) | Người chơi hết tin câu chuyện | Bộ sinh chỉ đọc nhật ký của engine, không tự bịa sự kiện |
| Random bị cho là bất công | Người chơi đổ lỗi cho game | Xúc xắc công khai kèm các khoản cộng; đạo diễn độ căng |
| 256 ô quá rộng, không gian không còn là giới hạn thật | Mất câu đố xếp đồ | Đồ lớn, ngân sách chặt; kiểm chứng ngay ở prototype giấy |
| Kết thúc "bán qua Campuchia" tham chiếu trực tiếp các đường dây lừa đảo, buôn người có thật | Gây phản cảm; có thể vi phạm chính sách nội dung của nền tảng phát hành | Hư cấu hóa địa danh và đường dây (một băng đảng giả tưởng đến từ đảo khác), giữ giọng hài đen kiểu phiêu lưu cướp biển |