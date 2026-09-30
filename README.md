# TEN TIDES

Game co-op 3D sống sót 10 ngày trên đảo, chạy trên trình duyệt. Mô tả thiết kế đầy đủ ở [PROJECT.md](PROJECT.md).

Hiện tại: **graybox giai đoạn 1** với phần lớn tính năng của MVP.

- **Chuẩn bị:** chọn một trong 6 nhân vật dựng sẵn là xong (ai thích thì mở "Tùy chỉnh chi tiết": chia điểm, 8 xuất thân, 6 tật xấu, dòng tự mô tả, màu áo), rồi bấm "Mua gói gợi ý" để có ngay xẻng, rìu, đồ ăn, thuốc... Đồ mua xong tự vào balo 16x16; ai muốn thì kéo thả sắp lại (xoay, ngăn bí mật, đồ đặt cạnh nhau tạo hiệu ứng, giới hạn ô, trọng lượng và ngân sách). Hết giờ thì đồ còn trong khay được nhét vào chỗ trống.
- **Luôn biết làm gì:** bảng "Việc hôm nay" dưới đồng hồ (mở sự kiện còn mấy cái, lương thực đủ cho đêm nay chưa, trang nhật ký, tiến độ kho báu, lúc nào phải về trại), mũi tên chỉ đường tới sự kiện gần nhất, chỗ đào kho báu (khi có xẻng) hay lửa trại (lúc sắp tối, khi đang vác rương), và mẹo hiện đúng lúc gặp chuyện lần đầu (cây, đồ dưới đất, lửa trại, đói, bơi, hoàng hôn...). Bảng phím tắt chỉ còn 6 phím cần nhất; ban đêm có 3 bước rõ ràng, lựa chọn phụ thu gọn.
- **Ban ngày:** khám phá đảo 4 vùng theo thời gian thực. Mỗi sáng engine xếp tối đa 7 thẻ (trong kho 57 thẻ, có thẻ theo thời tiết và chuỗi thẻ nối nhau) vào 19 điểm trên map: rừng dừa, bãi trôi dạt, hồ, hang, núi lửa, xác tàu đắm, phế tích trong rừng, mỏm đá tổ chim, suối nước nóng, rìa trại; xúc xắc công khai kèm các khoản cộng, tỷ lệ % trước khi chọn, và "vì sao thua" sau khi trượt. Có bản đồ nhỏ và cảnh báo không kịp về trại.
- **Thế giới theo seed:** quanh đảo chính là vùng biển 480x480 m với 4–6 đảo nhỏ (cồn cát, đảo rừng, đảo đá, đảo cát đen, đảo vòng), rạn san hô để lặn, 2–3 hang động và 1–2 hầm mỏ, chừng 15 easter egg, 5–7 điểm bất thường, bẫy và 19 loài sinh vật (thân thiện, trung tính, nguy hiểm; quen, lạ, biến dị). Bơi và lặn được, nín thở có giới hạn. Cùng seed bản đồ là cùng thế giới; chủ phòng nhập hoặc gieo seed ở sảnh chờ.
- **Tay chân:** cầm bất kỳ món nào trong balo lên tay (thanh đồ nghề giữa đáy màn hình) để đánh, bắn, ném, ăn, trồng cây; đặt đồ xuống đất, nhặt đồ người khác đánh rơi. Đánh nhau có chữ tượng thanh bay lên, số Máu mất, mảnh vụn văng, rung màn hình, bật lùi; ba trạng thái choáng (đứng hình), chóng mặt (đi loạng choạng, màn hình nghiêng ngả), mù (tối sầm). Leo cây (nhân vật ôm thân cây, chổng mông ra ngoài), chặt cây lấy gỗ, dừa, cây giống rồi trồng lại; đang leo mà cây bị đốn thì té mất Máu. Thú vật đánh chết được và rơi đồ (thịt, da, lông, xương, túi mực…), có con leo cây, bay lên hay lặn xuống để trốn; bơi ra khơi lâu thì có thể gặp cá mập. Dựng chòi lá, nhà sàn, hàng rào quanh lửa trại (ngủ trong nhà thì đỡ mất Tinh thần); nhổ lửa trại mang đi chỗ khác thì cả khu nhà dời theo. Kẻ phản bội có nút kết liễu một đòn, mỗi ngày một lần, không ai biết là ai cho tới màn lật bài.
- **Cốt truyện có hệ quả thật:** bình minh ngày 5 luôn có một biến cố (có người tới trước, bản đồ phải đọc ngược, người giấu còn sống, một đoàn khác trên đảo, núi lửa tỉnh sớm, kho báu có bẫy, mất mái chèo, họ hàng của người giấu) do engine chọn từ đầu ván: nó đổi chỉ số của đội và mở ra thẻ sự kiện nối tiếp, còn bộ sinh truyện dựng cả cốt truyện quanh nó. Mỗi ngày có một trang nhật ký của người xưa nằm đâu đó trên đảo, nhặt được thì thêm manh mối và một mảnh truyện. Ngủ ngoài trại thì gặp chuyện trong đêm (thú rình, mưa dầm, thủy triều, trời đầy sao...). Săn, hái được gì thì nướng ở lửa trại hoặc góp vào kho lương thực chung. Cuối ván có danh hiệu cho từng người (Tiều phu, Bạn thân của trọng lực, Nam châm hút bẫy...).
- **Thời tiết nhìn thấy được:** mây trôi nhiều ít theo ngày, mưa rơi, bão có gió giật làm cây cỏ lắc mạnh và sấm chớp, sương mù che tầm nhìn, động đất rung từng đợt; đêm quang có đom đóm. Chạy trên cát tung bụi, bơi thì mặt nước gợn vòng.
- **Môi trường nguy hiểm:** nhảy xuống hồ dung nham trong miệng núi lửa là chết ngay (y tá cũng không cứu được); giẫm vào đống lửa trại thì bỏng từng nhịp và bị hất bật ra; lặn quá sâu mà hết hơi thì ngoi lên rất chậm và mất Máu nhanh, còn bơi khi kiệt sức hay mang balo quá nặng thì chìm dần, không đạp nước (Space) là chết đuối thật.
- **Đồ họa mượt:** không còn kiểu tô phẳng low-poly: địa hình dùng lưới chung đỉnh nên màu và độ dốc chuyển mượt, mọi khối (người, thú, cây, đá, bụi, hang) được làm mịn pháp tuyến và bo tròn hơn, cạnh hộp, ván gỗ vẫn giữ sắc. Tám tấm vân sinh tại chỗ (gỗ, đá, lá, vải, cát, cỏ, vách đá, đất) phủ nhẹ lên mọi thứ theo toạ độ; địa hình trộn cát, cỏ, vách đá, đất theo từng đỉnh. Đồ họa Thấp tắt vân cho máy yếu.
- **Hai góc nhìn:** T (hay nút "Mắt nhìn" trên điện thoại) đổi giữa camera sau lưng và nhìn bằng mắt nhân vật (có chấm ngắm, thấy bàn tay và món đang cầm, vung lên khi đánh).
- **Chế tạo:** R mở bảng chế tạo: rìu đá, dao xương, giáo, ná, đuốc (cạnh lửa trại), dây thừng, lưới đánh cá, thuốc đắp, xiên nướng (cạnh lửa trại), bộ lửa trại, ván vá thuyền, từ gỗ, đá, da, xương, dừa, thịt, cá nhặt trên đảo. Món nào đủ nguyên liệu thì lên đầu; ván vá thuyền mang tới lửa trại bấm E để đóng vào thân thuyền.
- **Âm thanh:** toàn bộ tổng hợp tại chỗ bằng Web Audio, không cần file: bước chân theo mặt đất (cát, cỏ, đá, nước), đánh, chém, bắn, chặt cây, cây đổ, nổ, nướng, sấm; nền sóng biển, sóng vỗ bờ, gió, mưa, dế đêm, chim ngày, lửa trại lách tách, dung nham sôi, nước nhỏ giọt trong hang; dưới nước mọi tiếng ù đi; xúc xắc, chuông khi chạm trán, nhạc hiệu đổi pha; nhạc nền tự sinh đổi theo ngày, đêm và lúc căng thẳng. Có tiếng xa gần, trái phải theo hướng camera.
- **Xã hội và suy luận:** trao tay đồ cho người bên cạnh (G); ban đêm lục soát balo một người (thấy cả ngăn bí mật, người kia biết là có người lục); khảo sát kín "bạn nghi ai" mỗi đêm; hồn ma thì thầm vào giấc mơ, làm ai đó lạnh gáy hay dẫn lối; nút ⭐ (K) đánh dấu khoảnh khắc để xem lại ở màn lật bài. Trượt mấy lần liền thì được "Quyết tâm" cộng điểm; thẻ sự kiện hợp với đồ cả đội mang theo dễ xuất hiện hơn; khung nhân vật có nhật ký được mất chỉ số.
- **Điện thoại:** cần gạt để đi, vuốt để xoay camera, nút lớn cho đánh, ném, nhảy, lặn, dùng; balo chạm-chọn rồi chạm-đặt.
- **Ban đêm:** chat quanh đống lửa, bầu khẩu phần khi thiếu, đề cử và bỏ phiếu kín để trói, và mỗi người một hành động đêm bí mật.
- **Vai ẩn:** từ 4 người có thể có một kẻ phản bội (cướp biển nằm vùng hoặc kẻ lừa đảo), có thể có y tá. Sự cố tự nhiên mỗi đêm trông giống hệt phá hoại.
- **Kết thúc:** đào kho báu ở chỗ bí mật (cần xẻng), giữ thuyền đủ tốt, rời đảo tối ngày 10; 8 kết thúc, màn lật bài và biên niên sử.
- **Kể chuyện:** không dùng mô hình AI. Bộ sinh truyện chọn cốt truyện theo seed từ thư viện 110 yếu tố viết sẵn, rồi kể bình minh, hoàng hôn, lời kể riêng từng người và biên niên sử từ sự thật trong ván.

### Chế độ Battleground

Ở sảnh bấm **Tạo phòng Battleground** (bạn bè vào bằng mã phòng như thường). Bản đồ riêng: một hòn đảo lớn có núi, rừng, bãi biển, **thành phố** nhà cao 3–8 tầng (cầu thang lên tới sân thượng, cửa sổ bắn qua được), **cảng biển** lớn (bờ kè, cầu tàu, tàu hàng neo có đài chỉ huy, bãi container, nhà kho, cần cẩu giàn), **pháo đài** đá trên đồi (tường có lối đi, tháp góc, nhà chính), **bãi mìn** có rào thép gai (mìn chôn sẵn, giẫm là nổ), **kho vũ khí** quân sự (đồ hiếm: M249, AWM, giáp và mũ cấp 3) và mấy làng nhỏ.

- Bắt đầu trận: ai cũng xuất phát ở một chỗ ngẫu nhiên, có 20 giây chuẩn bị, 4000$ để bấm **B** mua súng (12 khẩu: súng lục, tiểu liên, súng trường, súng máy, bắn tỉa, shotgun), đạn, giáp, mũ, lựu đạn, bom khói, mìn, đồ hồi máu và trang phục ngụy trang (rừng rậm, sa mạc, thành phố, kỹ thuật số, tuyết, ghillie). Hạ gục ai được thêm 800$; người gục rơi hết đồ.
- Vùng an toàn thu hẹp dần qua 7 vòng, đứng ngoài vùng mất máu (càng về sau càng nhanh). Người cuối cùng còn sống thắng. Chủ phòng thêm được 0–50 máy (bot). Chế độ sinh tồn này không có xe tăng, không bán RPG.
- **Chế độ Đồng đội** (chọn ở sảnh, kiểu Arma): mỗi người vào phòng được 5 máy đi theo, đủ vai trò: 1 tay súng trường, 1 bắn tỉa (ghillie, ống 8x, nằm bắn từ xa), 1 súng máy (M249), 1 chống tăng (RPG-7), 1 lái xe tăng; số máy còn lại chia thành các đội máy 6 người (có đội trưởng, cũng có xe tăng). Cả đội xuất phát cùng một chỗ, đi theo đội hình mũi tên sau lưng người dẫn; không bắn trúng đồng đội. Ra lệnh: **F** tới chỗ đang nhìn, **G** giữ chỗ (ngồi canh quanh đây), **H** theo sau. Bảng đội góc trái hiện máu, vai trò từng người; đồng đội có tên trên đầu và chấm xanh trên bản đồ. Gục rồi thì **nhập vào** một máy còn sống trong đội (bấm 1–5, hay E với người đang xem): đứng đúng chỗ nó, cầm đồ của nó, đang lái tăng thì lái luôn. Đội cuối cùng còn người thắng.
- **Chế độ Chiến trường** (chọn ở sảnh): **50 người phe Xanh đấu 50 người phe Đỏ** (người chơi chọn phe ở sảnh, còn thiếu thì máy lấp cho đủ; chủ phòng chỉnh 5–50 người mỗi phe). Bản đồ riêng rộng hơn hẳn (gần 700 m mỗi cạnh, đất liền khoảng 600 × 500 m), hai căn cứ hai đầu (tường bao, bãi đậu 3 xe tăng mỗi phe) và **7 cứ điểm A–G** có công sự (vòng bao cát, lô cốt, tháp canh, cột cờ): Làng Thông, Pháo đài Đá, Kho Quân Nhu, Thị trấn Trung Tâm, Đồn Biên Phòng, Làng Suối, Nhà máy Xi măng; giữa các cứ điểm là đồi, rừng, ao. Kiểu cướp cờ: đứng trong vòng cứ điểm để hạ cờ địch rồi cắm cờ phe mình (đông người chiếm nhanh hơn, có địch trong vòng thì giằng co). Mỗi phe 250 vé: mỗi lần gục mất một vé, phe giữ ít cứ điểm hơn bị trừ vé dần; hết vé là thua. Gục thì sau 8 giây chọn lớp lính (súng trường, súng máy, bắn tỉa, chống tăng, lái tăng) và chỗ hồi sinh (căn cứ hay cứ điểm phe mình đang giữ); xe tăng bị phá thì một lúc sau căn cứ có xe mới. Máy chia nhau đi chiếm, giữ cứ điểm, tới nơi thì ngồi canh. Trên cùng màn hình là vé hai phe và dãy cứ điểm theo màu; bản đồ nhỏ vẽ vòng cứ điểm; đồng đội có dấu thoi xanh trên đầu.
- **Chống tăng**: RPG-7 (lớp Chống tăng, hay mua 2200$ ở chế độ có xe tăng; đạn 350$ một cặp): quả rocket bay có vệt khói, rơi dần, trúng xe tăng gây sát thương lớn, nổ lan cả người đứng gần. Máy chống tăng thấy xe tăng địch trong 150 m là vác RPG ra bắn. Súng thường cũng làm xe tăng mất máu dần (rất ít, cả tiểu đội xả vào mới hạ được).
- **Xe tăng**: đứng cạnh bấm **E** để lên (xe đội mình đang do máy lái thì máy nhường ghế), E lần nữa để xuống. W/S tiến lùi, A/D bẻ lái (quay tại chỗ được), chuột xoay tháp pháo về chỗ đang nhìn, nòng tự ngẩng theo đường đạn cong; chuột trái bắn pháo (nạp đạn 4,5 giây), chuột phải hay Q nhìn qua kính ngắm pháo thủ. Vòng tròn đỏ là chỗ nòng đang chĩa tới (xanh là đã nạp xong). Người trong xe không trúng đạn thường; lựu đạn, mìn, pháo làm xe mất máu, nổ tung thì người lái chết theo, xác xe cháy khói nằm lại làm chỗ nấp. Máy lái tăng theo đội hình, tránh nhà cửa, lùi ra khi kẹt, thấy địch thì quay tháp pháo bắn; máy bộ binh ném lựu đạn vào xe tăng địch ở gần. Rào, biển, bao cát, vật thấp dưới 1,3 m thì xe cán qua; đâm vào tường thì xe trượt theo mép chứ không đứng sững, chỉ dốc thật đứng mới chặn.
- Điều khiển: chuột trái bắn (giữ để liên thanh), chuột phải ngắm (camera qua vai; súng có ống ngắm thì nhìn qua ống 4x/8x), R thay đạn, 1–3 đổi súng, 4 lựu đạn, 5 bom khói, 6 bom choáng, 7 mìn (giữ chuột trái rút chốt, thả ra ném; đang giữ bấm thêm chuột phải thì ném thấp tay), 8 băng gạc, 9 hộp cứu thương, X cất súng (cầm dao), V đâm dao, E nhặt món đang nhìn vào (cạnh xe tăng thì lên xe), C ngồi xổm (đang chạy thì trượt), Z nằm sấp (bấm lại Z hay Space thì đứng dậy, C thì chuyển sang ngồi), Shift chạy, Space nhảy, T đổi góc nhìn, M bản đồ lớn, Tab bảng điểm, O (hoặc nút bánh răng) mở cài đặt.
- Nằm bắn: nằm sấp thì thấp nhất (đạn ngang ngực người đứng bay qua trên lưng), máy khó phát hiện hơn, súng giật và toả ít nhất, nhưng chỉ bò được chậm; nằm xuống, đứng dậy mất nửa giây (hạ súng). Người khác thấy đúng dáng nằm tì súng, bò đổi chân; server dò trúng theo thân nằm dọc hướng mặt.
- Súng có độ toả (ngắm, ngồi xổm thì chụm; chạy nhảy thì toả), giật theo đường riêng từng khẩu (dọc nặng dần rồi chững, ngang lượn cố định; ghì chuột xuống được, thả cò thì tâm ngắm hồi về; màn hình hất lên như lò xo, súng lùi vào vai), sát thương giảm theo tầm, trúng đầu nhân thêm; giáp và mũ chặn một phần sát thương và mòn dần. Máy mình dò trúng (khớp với những gì mình thấy), server kiểm tra lại từng phát (tốc độ bắn, đạn, vị trí, tường hay đồi chắn giữa).
- Đạn bay theo quỹ đạo: mỗi khẩu có sơ tốc thật (UMP45 300 m/s … AWM 945 m/s), đạn rơi dần theo trọng lực nên bắn xa phải ngắm cao hơn; vệt đạn sáng bay đúng tốc độ, võng theo đường rơi, bụi và lỗ đạn hiện đúng lúc đạn tới nơi. Thước ngắm chỉnh sẵn ở 100 m (súng lục, tiểu liên, shotgun 50 m); có ống kính thì PageUp/PageDown chỉnh cự ly, ống 4x/8x có vạch bù đạn rơi tính theo khẩu đang cầm.
- Ống ngắm mua hoặc nhặt được: Red Dot, Holo (kính phản xạ, chấm đỏ nổi trên kính), 2x, 4x ACOG, 8x (chỉ nhặt ở kho vũ khí, trên tàu). Tự lắp lên khẩu hợp (súng lục chỉ kính phản xạ, shotgun tới 2x, tiểu liên tới 4x), ống cũ rơi xuống. Ngắm bằng ống thì luôn nhìn qua kính; ai cũng thấy ống lắp trên súng. SKS, Kar98k, AWM giờ chỉ có thước ngắm sắt, phải kiếm ống.
- Góc nhìn thứ nhất có hai bàn tay đeo găng nắm súng, ống tay áo đúng bộ rằn ri; bắn thì lửa loé ở đầu nòng và soi sáng xung quanh.
- Thời tiết và giờ ngẫu nhiên mỗi trận (chủ phòng chọn được ở sảnh): nắng, nhiều mây, mưa (mặt đất, tường sẫm ướt), sương mù, bão (gió giật, sấm chớp), tuyết (hạt tuyết rơi, tuyết đọng trắng trên đất, mái, lá); bình minh, ban ngày, hoàng hôn hay ban đêm (trăng sáng đủ để đánh). Để ngẫu nhiên thì thời tiết còn chuyển dần giữa trận, trời trôi theo giờ.
- Hoạt ảnh: thay đạn (nghiêng súng, tay trái rút băng cũ rơi xuống, lấy băng mới đẩy vào, kéo khoá lên đạn), rút súng (đưa từ dưới lên, súng to lâu hơn; rút xong mới bắn được), khoá nòng / khối trượt lùi mỗi phát (súng lục hết đạn thì khối trượt kẹt ở sau, súng khoá nòng kéo khoá sau mỗi phát), lựu đạn cầm tay, rút chốt vung tay ra sau rồi ném; góc thứ ba người khác cũng thấy. Vỏ đạn văng ra cửa thoát bên phải, nảy leng keng trên sàn rồi nằm lại.
- Vượt vật cản: đứng trước bậu cửa sổ, bao cát, tường thấp (cao 0,45–1,35 m) bấm Space thì chống tay nhảy qua (chui qua cả ô cửa sổ). Đang chạy bấm C thì trượt tới vài mét rồi ngồi xổm. Chân bước theo tốc độ thật (đi khom bước ngắn, không lướt).
- Máy (bot) chơi công bằng: chỉ thấy trong tầm nhìn phía trước (ngồi xổm, đứng yên, ghillie thì khó thấy hơn), chỉ bắn khi đang thấy, mất dấu thì đi dò chỗ thấy lần cuối, nghe tiếng súng thì chỉ biết hướng đại khái.
- Âm thanh súng dựng lại theo súng thật (tiếng nổ siêu thanh, luồng khí đầu nòng, tiếng dội từ đồi núi; ở xa chỉ còn tiếng vọng), đanh và dứt khoát (tiếng nứt siêu thanh, tiếng tách đầu nòng rõ, thân trầm gọn), nhạc nền Battleground trầm, căng như phim chiến tranh. Cửa hàng có hình từng món.
- Đạn bay sượt qua người: đạn siêu thanh kêu "chát!" như roi quất (càng sát tai càng gắt), đạn chậm (UMP45, súng lục) rít "víu", lệch đúng bên đạn bay, đến đúng lúc viên đạn bay ngang (trước cả tiếng súng khi bắn từ xa); sát đầu thì giật mình rung màn hình. Nền sóng, gió, mưa dùng tiếng ồn trầm và nhỏ hơn hẳn (hết tiếng "rè rè"), trong trận còn nhỏ hơn nữa để nghe rõ bước chân. Xe tăng có tiếng máy diesel, xích lạch cạch theo tốc độ, tiếng pháo rền. Tiếng súng to hơn và vọng xa hơn.
- Vụ nổ (lựu đạn, pháo, RPG, xe tăng nổ tung): quả cầu lửa cuộn nhiều lớp, sóng xung kích lan trên mặt đất, tàn lửa bắn tung, đất đá văng, cột khói đen bốc cao; nổ lớn thì chớp sáng cả vùng.
- Cận chiến: V (hoặc chuột trái khi đã cất súng) đâm dao 50 sát thương, đâm sau lưng gấp đôi; server kiểm tra tầm với, hướng, tường chắn.
- Bom choáng: ai nhìn thấy chỗ nổ thì màn hình trắng xoá và ù tai (nhìn thẳng vào, đứng gần thì lâu nhất, quay lưng thì thoáng qua); máy (bot) bị loá cũng không bắn được. Lựu đạn nổ trong đám khói thì thổi thủng một khoảng vài giây rồi khói mới lấp lại.
- Đạn găm để lại lỗ trên tường, sàn, đất theo chất liệu (bê tông vỡ mẻ, kim loại thủng viền sáng, gỗ toác dằm, đất lõm hố), kèm bụi đúng màu, mảnh vụn văng, tia lửa trên kim loại, nước bắn tung, tiếng găm riêng; trúng người thì máu bắn lên tường phía sau.
- Di chuyển có quán tính (tăng tốc, hãm lại, trên không giữ đà chỉ lái được chút ít), nhảy có trọng lượng (rơi nhanh hơn lên), đáp đất nhún camera, khựng lại và có tiếng dậm. Đứng sát tường thì súng tự dựng lên, không xuyên qua vật cản (người khác cũng thấy vậy); đạn không bắn xuyên tường từ đầu nòng thò qua.
- Ngắm bằng thước ngắm sắt / kính phản xạ: súng trước mặt không bị phóng to theo góc ngắm (chỉ cảnh phóng to), thước ngắm sau là khe hở chứ không phải khối đặc, kính toàn ký của SCAR-L trong suốt có chấm đỏ, quai xách M249 lệch sang bên, thước ngắm AWM cao hơn ray: không còn cảnh khối súng che kín giữa màn hình. Nhìn bằng mắt khi ngắm thì không vẽ thêm tâm ngắm HUD đè lên thước ngắm.
- Nhẹ máy với 50 máy: người ở xa vẽ bằng hình người rút gọn vài khối, xa hơn 32 m thì thôi đổ bóng, xa hơn 16 m thì ẩn chi tiết nhỏ trên mặt, người sau lưng camera thì thôi tính dáng, ở xa tính cách một khung hình; bắn nhau ngoài tầm sương mù chỉ còn tiếng. Server: máy nhìn quanh lệch nhịp nhau, chỉ dò tia tới vài người gần nhất, độ cao địa hình lấy từ lưới tính sẵn (50 máy chừng 0,6 ms mỗi nhịp). Độ phân giải vẽ mặc định thấp hơn (Trung bình 1x, Cao 1,35x), ít biến thể tiếng súng dựng sẵn hơn (đỡ RAM).
- Cài đặt (cả hai chế độ, phím O hoặc nút bánh răng): độ nhạy chuột, độ nhạy khi ngắm và khi nhìn qua ống ngắm, đảo trục dọc, bấm hay giữ để ngắm, góc nhìn (FOV), làm mượt camera, nhún camera khi đi; đồ hoạ: chất lượng Cao/Trung bình/Thấp, giới hạn khung hình (mặc định 60 FPS cho đỡ nóng máy), độ phân giải vẽ tối đa, tự hạ độ phân giải khi bị giật, bảng số liệu hiệu năng (F3).
- Test nhanh: `BATTLE_SCALE=0.25 pnpm dev` thu ngắn pha chuẩn bị và các vòng thu hẹp.

Chưa có: bot tự chơi thay người rời ván, tự khôi phục phòng khi server khởi động lại, lưu ván xuống database.

## Chạy thử

Cần Node 22.12+ (repo có `.nvmrc` trỏ tới Node 24) và pnpm.

```sh
nvm use
pnpm install
pnpm dev
```

- Client: http://localhost:5180
- Server Colyseus: ws://localhost:2567

Mở hai tab (mỗi tab là một người chơi riêng), tab đầu bấm **Tạo phòng mới**, tab sau nhập mã phòng (hoặc dán link mời). Bạn bè cùng mạng LAN mở `http://<IP-máy-bạn>:5180`.

Chủ phòng bấm **Bắt đầu ván** khi đủ người. Ván đã bắt đầu thì không ai vào thêm được.

Điều khiển: bấm vào màn hình để khoá chuột, di chuột để xoay camera, WASD di chuyển, Shift chạy (tốn sức bền), Space nhảy (dưới nước: ngoi lên), C ngồi xuống/đứng dậy (ngồi hồi sức nhanh gấp đôi; ngồi trong đám cỏ cao là nấp: người khác không thấy tên và chấm của bạn trên bản đồ; đang bơi thì giữ C để lặn), E mở điểm sự kiện, đào kho báu, xem xét easter egg và điểm bất thường, vuốt ve sinh vật thân thiện, nhặt đồ hay trang nhật ký dưới đất, nướng hoặc góp món đang cầm vào kho khi đứng cạnh lửa trại, leo cây (đang leo: W/S lên xuống, A/D vòng quanh thân, Space nhảy ra, E buông tay) hoặc nhổ lửa trại, chuột trái đánh, chặt cây, bắn, hay ăn, trồng, đặt lửa trại tuỳ món đang cầm, giữ rồi thả chuột phải để ném (giữ càng lâu ném càng xa), Q hoặc lăn chuột để đổi món cầm, X đặt món đang cầm xuống đất, V bật chế độ dựng nhà (bấm tiếp để đổi công trình, lăn chuột để xoay, chuột trái để dựng, Esc để thôi), F kết liễu (chỉ kẻ phản bội, khi đứng sát ai đó), phím 1–4 chọn trong thẻ, B xem balo, R chế tạo, T đổi góc nhìn, J mở sổ truyện, H bật/tắt bảng phím tắt (bấm "Tất cả phím" để xem đủ), G đưa món đang cầm cho người bên cạnh, K đánh dấu khoảnh khắc, M tắt/bật âm thanh, N tắt/bật nhạc nền (hoặc bấm nút loa, nút nhạc trên khung phòng), P đổi đồ họa Cao → Trung bình → Thấp (mặc định Trung bình: bỏ bóng tối ở khe, bóng đổ cập nhật thưa hơn, cỏ thưa hơn; Thấp bỏ hậu kỳ và vân chất liệu, bớt cỏ cây, bóng đổ nhẹ hơn cho máy yếu), F3 bật bảng số liệu hiệu năng (khung hình, thời gian CPU, số lệnh vẽ, độ phân giải), Enter để chat, Esc thả chuột. Lúc xếp balo: kéo thả, R hoặc chuột phải để xoay, nhấp đúp để nhấc ra khay.

Test nhanh cả ván: `PHASE_SCALE=0.1 pnpm dev` thu mỗi ngày từ 5 phút xuống còn khoảng 30 giây. Ở chế độ dev, `window.__tentides` trong console trình duyệt cho xem room, vị trí, camera và thế giới đã sinh (`world`); `__tentides.debugCam` là camera tự do (đặt `enabled`, `position`, `target`) để soi bản đồ.

## Lệnh

| Lệnh | Việc |
| --- | --- |
| `pnpm dev` | Chạy server và client cùng lúc, tự tải lại khi sửa code |
| `pnpm play` | Build client rồi chạy server và bản build (nhẹ và mượt hơn bản dev, dùng khi chơi thật hay đo hiệu năng) |
| `pnpm test` | Chạy test (Vitest) cho engine luật, nội dung và server |
| `pnpm typecheck` | Kiểm tra kiểu cho mọi package |
| `pnpm --filter @tentides/client build` | Build client tĩnh ra `apps/client/dist` |
| `pnpm --filter @tentides/server sim --games 3000 --players 4-6` | Bot chơi N ván, in phân phối kết thúc và các chỉ số cân bằng |
| `pnpm --filter @tentides/server replay logs/<file>.json --verbose` | Phát lại một ván từ file log |

Biến môi trường:

- `PORT`: cổng của server, mặc định 2567.
- `PHASE_SCALE`: co giãn thời lượng các pha, mặc định 1.
- `BATTLE_SCALE`: co giãn thời gian chuẩn bị và các vòng thu hẹp của Battleground, mặc định 1.
- `BATTLE_DEV`: đặt `1` khi thử nghiệm để server nhận lệnh `devTeleport` (dịch chuyển tức thời, vd. `__tentides.room.send("devTeleport", { x, z })`). Không bật khi chơi thật.
- `GAME_LOG_DIR`: thư mục ghi log ván (seed + chuỗi hành động + chat), mặc định `logs/`.
- `VITE_SERVER_URL`: địa chỉ server cho client, dùng khi server không nằm cùng máy (vd. `wss://tentides.fly.dev`).
- `DATABASE_URL`: chuỗi kết nối PostgreSQL để bật tài khoản, kho skin và gacha (vd. `postgres://tentides:tentides@localhost:5432/tentides`). Không đặt thì server chỉ cho chơi khách.

### Tài khoản, skin súng và gacha (PostgreSQL)

Tài khoản là tuỳ chọn: không có database thì game chạy y như cũ, bảng đăng nhập ở sảnh tự ẩn.

```sh
scripts/db-dev.sh                 # lần đầu: tạo .pgdata/, chạy PostgreSQL ở cổng 5432, tạo database "tentides"
DATABASE_URL=postgres://tentides:tentides@localhost:5432/tentides pnpm dev
scripts/db-dev.sh stop            # tắt PostgreSQL
```

Không có PostgreSQL cài sẵn thì dùng docker: `docker run -d --name tentides-pg -p 5432:5432 -e POSTGRES_USER=tentides -e POSTGRES_PASSWORD=tentides -e POSTGRES_DB=tentides postgres:16`.

- Server tự chạy migration lúc khởi động (`apps/server/src/db/migrations.ts`, ghi vào bảng `schema_migrations`). Thêm bảng hay cột thì thêm migration mới vào cuối danh sách.
- API HTTP chạy chung cổng với Colyseus (`apps/server/src/api/api.ts`): `POST /api/register`, `POST /api/login`, `POST /api/logout`, `GET /api/me`, `POST /api/gacha/roll`, `POST /api/skins/equip`, `GET /api/gacha/catalog`, `GET /api/status`.
- Mật khẩu băm bằng scrypt (muối ngẫu nhiên); token phiên 32 byte, database chỉ giữ bản băm sha256, hết hạn sau 30 ngày.
- Vào phòng kèm phiên đăng nhập thì nhân vật gắn với tài khoản (id `u<id>`, tên tài khoản, skin đang lắp nằm trong `PlayerState.skins`). Hết trận Battleground, người có tài khoản được cộng xu theo số mạng, hạng và thắng trận.
- Danh mục skin, tỷ lệ rơi và luật bảo hiểm gacha nằm trong `packages/content/src/skins.ts`. Test tích hợp với database thật chỉ chạy khi có `DATABASE_URL`: `DATABASE_URL=... pnpm test`.

## Cấu trúc

```
apps/
  client/     three.js + React Three Fiber + Rapier, build bằng Vite
  server/     Colyseus: phòng chơi, kiểm tra hành động của người chơi
packages/
  rules/      Engine luật thuần: vòng ngày, thẻ sự kiện, xúc xắc, PRNG có seed
  content/    Dữ liệu game kiểm tra bằng zod: đồ vật, thẻ sự kiện, bản đồ đảo
  protocol/   Hợp đồng mạng dùng chung: state đồng bộ, message, hằng số
  story/      Bộ sinh cốt truyện theo seed: không gọi AI, ghép lời kể từ thư viện yếu tố
```

Các package trỏ thẳng vào mã nguồn TypeScript (`exports: ./src/index.ts`), không cần bước build riêng.

Một số quy ước:

- Luật chơi nằm trong `reduce(state, action, config)` ở `packages/rules/src/game.ts`: hàm thuần, có tính xác định. Server chỉ đưa hành động vào, rồi chép kết quả sang state của Colyseus (`apps/server/src/sync.ts`). Dữ liệu thời gian thực (ai đang đứng ở đâu) nằm ngay trong hành động, nên seed + chuỗi hành động là đủ để phát lại cả ván.
- `rules` không phụ thuộc 3D, mạng hay AI. `simulate.test.ts` cho bot chơi 500 ván để bắt lỗi luật.
- Mọi thứ ngẫu nhiên có ảnh hưởng tới ván chơi đều đi qua PRNG trong `rules`, không dùng `Math.random()`. Chỉ mã phòng và hiệu ứng xúc xắc đang lăn trên client là dùng random thường.
- Thêm đồ, thẻ sự kiện, yếu tố truyện hay mẫu câu chỉ cần sửa `items.json`, `cards.json`, `story.json` hoặc `story_templates.json` trong `packages/content/src/data/`. Điểm sự kiện trên map nằm trong `ANCHORS` ở `island.ts`. Sinh vật, easter egg, điểm bất thường, bẫy và tên đảo, hang, hầm nằm trong `world.json`; mô hình 3D của từng loài khai báo bằng dữ liệu trong `apps/client/src/game/Wildlife.tsx`.
- Đảo chính cố định (`island.ts`); mọi thứ quanh nó do `generateWorld(seed)` trong `packages/content/src/worldgen.ts` sinh ra, hàm thuần nên client và server dựng cùng một thế giới. Client và server nên dùng `world.heightAt()` thay cho `heightAt()` của đảo chính. Seed bản đồ công khai; bẫy dùng một seed suy từ seed bí mật của ván (`generateTraps`), nên chỉ lộ khi có người sập. Sinh vật do server cho đi lại (`apps/server/src/wildlife.ts`), hơi thở và bẫy do `apps/server/src/hazards.ts` tính; khi có người bị cắn, sập bẫy, nhặt easter egg thì server đưa hành động `encounter` vào engine luật, nên log ván vẫn phát lại được. `loadContent()` sẽ báo lỗi nếu sai schema hoặc tham chiếu tới id không tồn tại.
- Âm thanh nằm trong `apps/client/src/game/sound/`: `engine.ts` (bộ máy, tiếng xa gần, trái phải, ù dưới nước), `sfx.ts` (công thức từng tiếng động), `Soundscape.tsx` (nền, bước chân, nhạc, tiếng theo sự kiện). Thêm tiếng mới chỉ cần thêm một công thức vào `RECIPES`.
- Dung nham, lửa trại và hơi thở do server tính trong `apps/server/src/hazards.ts`; chết vì dung nham là chạm trán `fatal` trong engine luật.
- Biến cố ngày 5 (`packages/rules/src/game/twists.ts`) và chuyện đêm ngủ ngoài (`data/nights.json`) nằm trong engine luật; bộ sinh truyện chỉ kể lại. Trang nhật ký có vị trí theo seed bản đồ (`world.pages`), nội dung do `diaryPage()` trong `packages/story` viết. Danh hiệu cuối ván do server tính (`apps/server/src/awards.ts`), chỉ để vui, không ảnh hưởng thắng thua.
- Cầm, đánh, ném, chặt cây, trồng cây, dựng nhà, dời trại do server quyết định (`apps/server/src/play.ts` cho phần tính toán, `playRoom.ts` cho phần nhận lệnh và đồng bộ); chỉ số của từng món nằm trong `items.json` (`melee`, `ranged`, `throw`, `chop`, `eat`, `plant`, `build`, `camp`), chỉ số chung (tay không, cây, té ngã) trong `packages/content/src/combat.ts`, công trình trong `world.json`. Thứ gì đổi balo hay chỉ số (đặt, nhặt, ăn, bị đánh, té cây, dựng nhà, kết liễu) đều đi qua engine luật như một hành động, nên log ván vẫn phát lại được. Người bị kết liễu chỉ hiện là "gục ngã"; ai ra tay chỉ lộ ở màn lật bài.
- Client tự tính di chuyển (Rapier) rồi báo vị trí lên server. Server không chạy vật lý, nhưng kéo người chơi về chỗ cũ nếu vị trí vượt tốc độ chạy, ra ngoài map hoặc chui xuống đất (`apps/server/src/movement.ts`).
- Thông tin riêng (vai, hành động đêm, ghi chú, balo đầy đủ, lời kể riêng) không nằm trong state chung: server tính `privateView` cho từng người và chỉ gửi cho đúng người đó. Trong state chung, `items` chỉ gồm đồ ngoài ngăn bí mật.
- Chat không nằm trong state: server chỉ gửi tin cho đúng người được nghe (`chatAudience` trong `IslandRoom.ts`) và giữ biên bản từng đêm để sau này AI dùng làm dữ liệu kể chuyện.
- State trong `protocol` chỉ chứa thứ công khai (có cả seed bản đồ; seed của engine luật thì không bao giờ gửi xuống client, vì từ nó suy ra được vai ẩn và chỗ kho báu). Phiếu trói là phiếu kín: engine giữ phiếu thật, state chỉ công khai ai đã bầu cho tới khi lật. Vai của mọi người và hành động từng đêm chỉ được chép vào state khi ván kết thúc (màn lật bài).
