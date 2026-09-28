# Feature Research

**Domain:** Game co-op sinh tồn + suy luận xã hội (có thể có kẻ phản bội) chơi online qua link, dạng prototype chữ, có AI Game Master (LLM) kể chuyện. Người chơi: một nhóm bạn Việt Nam 4–6 người.
**Researched:** 2026-09-25
**Confidence:** MEDIUM. Số liệu về luật, số thẻ của board game và cơ chế game số lấy từ nguồn chính thức hoặc nhiều nguồn khớp nhau (HIGH/MEDIUM). Ước lượng khối lượng nội dung và mục tiêu tỷ lệ kết thúc là suy luận từ các game tương tự (MEDIUM/LOW), phải kiểm chứng bằng bot sim và playtest.

## Cách đọc tài liệu này

- **"Table stakes" hiểu theo bối cảnh prototype cho nhóm bạn**, không phải chuẩn phát hành thương mại. Thiếu những thứ này thì ván 45–60 phút gãy giữa chừng, nhóm bỏ cuộc, hoặc không trả lời được câu "có vui không".
- **Complexity** (LOW/MEDIUM/HIGH) tính cho stack đã chọn: engine C# thuần + ASP.NET Core/SignalR + web client mỏng.
- **Mã ID** (L1, H3, B5…) để REQUIREMENTS.md và roadmap tham chiếu: L = Lobby & session, H = Hidden roles, S = Survival loop, B = Backpack, R = Randomness, A = AI narration, C = Content, T = Balance tooling & telemetry, D = Differentiator.

## Feature Landscape

### Table Stakes (Users Expect These)

Thiếu thì người chơi thấy game hỏng hoặc "chơi ép". Có thì không ai khen, nhưng thiếu thì bị phạt.

#### 1. Lobby & session

| ID | Feature | Why Expected | Complexity | Notes |
|----|---------|--------------|------------|-------|
| L1 | Mã phòng ngắn + link mời chứa sẵn mã | Jackbox dùng mã 4 chữ, Among Us 6 chữ, Secret Hitler Online cho vào bằng mã hoặc link. Nhóm bạn gửi link qua Zalo/Messenger là vào | LOW | 4–5 ký tự, bỏ ký tự dễ nhầm (0/O, 1/I/L); link dạng `/r/ABCD`; không cần tài khoản |
| L2 | Nhập tên, không đăng ký; token phiên lưu ở trình duyệt | Chuẩn của party game web. Jackbox cho vào lại bằng mã + tên | LOW | Khoá định danh phải là token ngẫu nhiên, không phải tên, để không ai gõ trùng tên mà chiếm được vai của bạn |
| L3 | Rớt mạng vào lại đúng ván, nhận lại đủ trạng thái riêng (vai, balo, ngăn bí mật, lời kể riêng đã nhận) | Among Us **không** cho vào lại ván đang chơi và đây là lời phàn nàn lâu năm. Jackbox giữ chỗ khi vào lại. Ván 45–60 phút chạy qua tunnel thì gần như chắc chắn có người rớt mạng | MEDIUM | SignalR reconnect + server gửi lại snapshot theo góc nhìn người đó. Phụ thuộc event log |
| L4 | Người rời hẳn thì bot giữ nhân vật ở trại | "Zombie mode" của Board Game Arena: ván đi tiếp, bot không được kết thúc ván sớm và không được thiên vị ai | MEDIUM | BGA khuyên chỉ cần mức "pass" hoặc "random hợp lệ", đừng làm AI giỏi. Kẻ phản bội bị bot thay thì ngừng phá hoại và không lộ vai. Bot này dùng lại cho mô phỏng (T1) |
| L5 | Quyền chủ phòng: bắt đầu ván, chọn độ khó, kick, tạm dừng | Jackbox thêm tính năng kick ở Party Pack 9 (2022) vì thiếu nó là vấn đề thật; Jackbox tự tạm dừng tối đa 5 phút khi host mất kết nối | LOW | Chơi với bạn thì luôn có lúc ai đó phải đi vắng, nên cần pause. Chủ phòng **không** được thấy bí mật |
| L6 | Nút "Sẵn sàng" và thanh "đang chờ ai" trước mỗi pha lớn | Sảnh chờ của Among Us và Jackbox; tránh để một người bị cuốn theo khi chưa đọc xong | LOW | Kết hợp timer: đủ người sẵn sàng thì chuyển ngay, hết giờ thì tự chuyển |
| L7 | Khôi phục ván khi server khởi động lại | Server chạy trên máy dev + tunnel, nên restart hoặc crash là rủi ro thật chứ không phải lý thuyết | MEDIUM | Replay event log từ seed. Chỉ làm được nếu engine xác định (deterministic) |
| L8 | Trạng thái kết nối từng người (online / mất kết nối / bot đang giữ) | Nhóm cần biết đang chờ ai | LOW | |

#### 2. Hidden roles & social deduction

| ID | Feature | Why Expected | Complexity | Notes |
|----|---------|--------------|------------|-------|
| H1 | Màn nhận vai riêng, mặc định che ("giữ để xem"), xem lại được bất cứ lúc nào | Nhóm bạn hay share màn hình trên Discord/Zalo call. Các bản online như Secret Hitler và Among Us đều có màn lật vai riêng | LOW | Thẻ vai che mặc định là cách chống lộ vai rẻ nhất |
| H2 | Kênh thông tin riêng tách hẳn kênh chung (khung "Chỉ mình bạn thấy", màu khác) | Wolvesville tách chat chung và tin riêng; grimoire của BotC chỉ Storyteller thấy | MEDIUM | Server lọc theo người nhận. **Không** gửi cho tất cả rồi ẩn bằng client |
| H3 | Pha đêm: **ai cũng có một hành động bí mật**, pha kéo dài cố định dù mọi người bấm xong sớm | Đêm của Town of Salem cố định 37 giây. App One Night Ultimate Werewolf giữ nhịp gọi vai cố định để không lộ ai đang hành động. Nếu chỉ kẻ phản bội có việc làm ban đêm thì thời điểm bấm nút đã tố cáo hắn | MEDIUM | Người thường có lựa chọn thật: canh gác, nghe ngóng, ngủ bù (hồi Tinh thần), lén lấy đồ. Vừa che hành động của kẻ phản bội vừa thêm drama |
| H4 | Bỏ phiếu trói: chỉ mở khi có người đề cử; mọi người khoá phiếu cùng lúc rồi lật đồng loạt, hiện rõ ai bầu ai; có "bỏ qua"; hoà hoặc không đạt đa số thì không trói ai | Among Us: phiếu skip thắng, hoà, hoặc không ai bầu thì "No one was ejected". Secret Hitler lật phiếu Ja/Nein đồng loạt. Dead of Winter chỉ bỏ phiếu khi có người khởi xướng. Phiếu công khai là dữ liệu để suy luận | LOW | Chỉ bỏ phiếu khi có đề cử (giống nomination của BotC) giúp đêm yên ắng trôi nhanh, giữ mục tiêu 4–5 phút/ngày |
| H5 | Thời gian thảo luận có giới hạn, chủ phòng kéo dài được, cả nhóm bấm "xong" thì rút ngắn | Among Us cho chỉnh thảo luận 15–300 giây và bỏ phiếu 0–300 giây, gợi ý nhóm 5–6 người dùng 30 + 60 giây; Wolvesville 60 + 30 giây. Nhóm có voice call ngoài game cần ít giờ chat trong game hơn | LOW | **Đêm 60 giây trong tài liệu là quá ngắn nếu chat bằng chữ.** Nên mặc định 90–150 giây, cấu hình được |
| H6 | Người chết hoặc bị trói vẫn có việc để làm | Among Us: hồn ma vẫn làm task, impostor chết vẫn phá được. Don't Starve Together: có hồn ma và hồi sinh. Dead of Winter: người bị exile nhận mục tiêu mới. Loại người chơi quá sớm là lý do chính khiến Werewolf với nhóm nhỏ kém vui | MEDIUM | Chết ở ngày 3 nghĩa là ngồi xem 40 phút. Gợi ý: hồn ma xem kênh chung, chat với hồn ma khác, mỗi đêm được 1 "lời thì thầm" ngắn hoặc 1 hành động nhỏ. Người bị trói vẫn làm việc ở trại (sửa thuyền, nấu ăn) |
| H7 | Màn lật bài cuối ván: vai từng người, ngăn bí mật từng balo, dòng thời gian hành động đêm của kẻ phản bội, các lần tung xúc xắc quyết định | Đây là khoảnh khắc "hoá ra là mày!". Người chơi BotC có thói quen cùng xem lại grimoire khi hết ván; màn kết của Among Us lộ impostor | MEDIUM | Lấy dữ liệu từ event log, **không** nhờ AI nhớ |
| H8 | Trói xong **không** xác nhận ngay là đúng hay sai | Among Us có tuỳ chọn "Confirm Ejects": bật lên thì bí ẩn chết. BotC không lộ vai người đã chết. Với luật "0 hoặc 1 kẻ phản bội" và kết thúc "Lật mặt kẻ phản bội", xác nhận ngay sẽ giết sự nghi ngờ | LOW | Cần chốt ở discuss-phase. Khuyến nghị: chỉ để hệ quả gián tiếp (ví dụ đêm sau không còn phá hoại) |

#### 3. Co-op survival loop

| ID | Feature | Why Expected | Complexity | Notes |
|----|---------|--------------|------------|-------|
| S1 | Chỉ số cá nhân Máu / No / Tinh thần kèm nhật ký thay đổi ("−10 No: ngủ ngoài") | Don't Starve Together luôn hiện 3 đồng hồ; người chơi phải thấy nguyên nhân, không chỉ con số | LOW | Chỉ 3 chỉ số. Đừng thêm khát, nhiệt độ… |
| S2 | Bảng tài nguyên chung luôn hiển thị: tiến độ kho báu, mức núi lửa, độ bền thuyền, lương thực chung | Thanh morale/food của Dead of Winter; đồng hồ đếm ngược chung tạo lý do để hợp tác | LOW | |
| S3 | Bản đồ điểm: thấy ai đang ở đâu, chi phí giờ mặt trời của mỗi đường, giờ còn lại, và **chi phí quay về trại** | Nếu người chơi phải ngủ ngoài chỉ vì không tính được giờ, họ sẽ thấy game chơi ép. Ngủ ngoài phải là lựa chọn có chủ đích | MEDIUM | Cảnh báo khi đi tiếp sẽ không kịp về trại |
| S4 | Lên kế hoạch đồng thời rồi giải quyết, không đi theo lượt từng người | Robinson Crusoe cho mọi người gán hành động cùng lúc. 4–6 người ngồi chờ lượt nhau trên web rất chán | MEDIUM | Sự kiện của nhóm A và nhóm B chạy song song. Còn câu hỏi mở: quỹ giờ theo lượt hay đồng hồ thật (xem Anti-Features) |
| S5 | Sự kiện chỉ gồm người đứng tại điểm; người khác xem trực tiếp xúc xắc công khai của nhóm kia trong lúc chờ | Luật gốc của thiết kế. Phát xúc xắc trực tiếp cho cả phòng lấp được khoảng chờ | MEDIUM | Nội dung lựa chọn và lời kể riêng vẫn chỉ gửi cho người tại điểm |
| S6 | Hoàng hôn: tổng kết ngày cho cả đội (ai đi đâu, được gì, mất gì, phần công khai) | Khi chia nhóm, mọi người cần bức tranh chung trước khi tranh luận ban đêm | LOW | Dữ liệu do engine đưa, AI chỉ viết lời |
| S7 | Ngủ ngoài có hậu quả rõ ràng, báo trước | Robinson Crusoe: không có chỗ trú thì mỗi người mất 1 máu mỗi đêm. Don't Starve: bóng tối giết người | LOW | |
| S8 | Chia khẩu phần có mặc định hợp lý (chia đều); chỉ bỏ phiếu khi thiếu | Oregon Trail cho chọn mức khẩu phần. Bắt bỏ phiếu mỗi đêm cho một việc nhàm sẽ bào mòn thời gian | LOW | |

#### 4. Backpack 16x16

| ID | Feature | Why Expected | Complexity | Notes |
|----|---------|--------------|------------|-------|
| B1 | Kéo thả có bóng xem trước bắt dính lưới, ô xanh/đỏ báo hợp lệ, thả sai thì đồ tự bật về chỗ cũ | Chuẩn của "inventory tetris" (Resident Evil 4, Escape from Tarkov, Backpack Hero) | MEDIUM | Client kiểm tra để phản hồi tức thì; server kiểm tra lại mọi lần đặt có hệ quả |
| B2 | Xoay bằng phím R / chuột phải / nút xoay trong lúc kéo | Backpack Hero xoay bằng chuột phải hoặc phím mũi tên; R là quy ước phổ biến | LOW | |
| B3 | Khay tạm cho đồ đã mua nhưng chưa xếp | Resident Evil 4 có chỗ để đồ tạm khi sắp lại cặp | LOW | **Báo trước** đồ còn trong khay khi hết giờ sẽ ra sao (mất hay hoàn tiền) |
| B4 | Thanh trọng lượng và ngân sách cập nhật tức thì; tooltip đồ (kích thước, cân nặng, giá, thẻ, hiệu ứng kề cạnh) | Ba giới hạn chạy cùng lúc thì phải nhìn thấy cùng lúc | LOW | |
| B5 | Rê chuột lên đồ thì các ô kề cạnh có hiệu ứng sáng lên | Backpack Battles dùng dấu sao/kim cương cho ô kề cạnh; Backpack Hero có đồ chỉ mạnh khi đặt cạnh vũ khí hoặc ô trống | MEDIUM | |
| B6 | Ngăn bí mật 4x4 là vùng trông khác hẳn | Secure container 3x3 của Tarkov tách biệt rõ với phần balo thường | LOW | |
| B7 | Timer xếp balo có cảnh báo 30 giây cuối + nút "Xong" để kết thúc sớm | Tài liệu đặt 4 phút | LOW | Ván đầu tiên nên cho thời gian dài hơn hoặc dùng timer mềm, vì người mới phải học lưới 256 ô |
| B8 | Xem được phần công khai của balo đồng đội (trừ ngăn bí mật) | Co-op cần phối hợp "ai mang xẻng". Bản 3D đã thiết kế "đồ lớn hiện trên người" | LOW | Đề xuất trả lời câu hỏi mở theo hướng: **có**, trừ ngăn bí mật |

**Lưu ý về kích thước lưới (MEDIUM):** 16x16 = 256 ô lớn hơn nhiều so với các game cùng thể loại. Cặp lớn nhất của Resident Evil 4 là 10x13 = 130 ô (bắt đầu từ 6x10 = 60); mỗi class trong Backpack Battles bắt đầu với 12–14 trên tổng 63 ô; Backpack Hero bắt đầu từ 3x3. Nhiều khả năng không gian sẽ không phải giới hạn chạm đầu tiên. Cần một tham số "vùng dùng được" (khoá bớt ô, mở theo Thể lực hoặc túi mua thêm như Backpack Battles), và bot sim phải ghi lại giới hạn nào chạm trước (xem T1).

**Lưu ý thiết bị (MEDIUM):** Party game web như Jackbox hay MysteryPartyNow mặc định người chơi vào bằng điện thoại. Lưới 16x16 trên màn hình 360px chỉ còn khoảng 22px mỗi ô, kéo thả và xoay rất khó. Cần chốt sớm: v1 là **máy tính trước**, điện thoại chỉ "dùng được". Nếu nhóm test chủ yếu cầm điện thoại thì cần chế độ chạm-chọn / chạm-đặt.

#### 5. Randomness & fairness

| ID | Feature | Why Expected | Complexity | Notes |
|----|---------|--------------|------------|-------|
| R1 | Hiện tỷ lệ thành công **trước** khi chọn phương án | Baldur's Gate 3 hiện DC và các khoản cộng trước khi tung; Disco Elysium hiện phần trăm ngay trên lựa chọn | LOW | Người chơi chọn có thông tin, nên thua cũng ít cay hơn |
| R2 | Tung xúc xắc công khai kèm phân rã: xúc xắc + thuộc tính + đồ + trạng thái so với DC | Luật gốc. Tabled (AI GM năm 2026) được khen chính vì mọi lần tung đều do server làm và kiểm toán được | LOW | Hoạt ảnh 1–2 giây, cũng là khoảng đệm cho AI viết |
| R3 | Lịch sử tung xúc xắc xem lại được | Minh bạch; cũng là nguồn cho màn lật bài (H7) | LOW | |
| R4 | Mọi random đi qua PRNG có seed trên server | Nền tảng cho replay, bot sim và kiểm thử | MEDIUM | |
| R5 | Thất bại vẫn đẩy câu chuyện đi tiếp (fail forward), không "không có gì xảy ra" | Sid Meier (GDC 2010): người chơi mặc định thắng khi tỷ lệ 3:1 và rất ghét thua, nên thua phải có hệ quả thú vị | LOW | Là quy tắc viết thẻ, không phải code |

#### 6. AI narration

| ID | Feature | Why Expected | Complexity | Notes |
|----|---------|--------------|------------|-------|
| A1 | Engine chốt kết quả xong rồi AI mới kể | Tabled: xúc xắc "handed to the narrator already committed", AI kể quanh kết quả nó không chọn và không sửa được. Friends & Fables và AI Realm cũng cho engine giữ luật. Các nền tảng thả nổi (AI Dungeon) bị chê vì trí nhớ trôi | MEDIUM | Khớp nguyên tắc "engine quyết định, AI kể chuyện" |
| A2 | Không bao giờ treo: timeout cứng mỗi lời gọi + lời văn mẫu dự phòng | Mẫu chuẩn khi đưa LLM vào game: không bao giờ chặn input của người chơi để chờ LLM | MEDIUM | |
| A3 | Stream hoặc hiệu ứng gõ chữ + dấu hiệu "Người kể đang viết…" | Chờ trên 400–800 ms mà không có phản hồi là người dùng khó chịu | MEDIUM | Xúc xắc và hoàng hôn là khoảng đệm tự nhiên |
| A4 | Lời kể ngắn, có trần độ dài mỗi nhịp (khoảng 60–120 chữ) | 4–6 người cùng đọc; mục tiêu 4–5 phút/ngày không chứa nổi những đoạn văn dài | LOW | Là ràng buộc trong prompt và schema |
| A5 | Tách ngữ cảnh chung/riêng bằng kiến trúc | Nghiên cứu LLM chơi Werewolf đều cách ly thông tin theo vai, vì LLM hay buột miệng thông tin riêng "để nghe có vẻ sắc sảo" | MEDIUM | Prompt bản chung không bao giờ chứa vai ẩn hay ngăn bí mật |
| A6 | Không mâu thuẫn trạng thái: kiểm tra tên đồ, tên người, ai đã chết trước khi gửi | AI Dungeon: bộ nhớ xuống cấp, và nhiều người chơi thì context đầy nhanh gấp 4. Tabled có lúc bịa câu trả lời thay vì thừa nhận đã quên | MEDIUM | Có sổ sự thật + kiểm tra hậu kỳ; sai thì dùng lời văn mẫu |
| A7 | Nhật ký chữ của cả ván (kênh chung) cuộn lại đọc được | Người rớt mạng hoặc đi vắng cần đọc lại | LOW | |

#### 7. Content

| ID | Feature | Why Expected | Complexity | Notes |
|----|---------|--------------|------------|-------|
| C1 | Không lặp thẻ trong một ván | Slay the Spire: mỗi event chỉ gặp tối đa 1 lần mỗi lượt chơi. Lặp thẻ trong cùng ván là lộ ngay "máy" | LOW | Bộ rút bài loại thẻ đã dùng |
| C2 | Đủ xuất thân và tật xấu cho 6 người | Tài liệu có 6 xuất thân nhưng chỉ **5 tật xấu**, nên người thứ 6 buộc phải trùng | LOW | Nên có ≥8 mỗi loại (xem Content Volume Estimate) |
| C3 | Validator kiểm tra schema trước khi nạp nội dung | Thẻ lỗi làm treo ván giữa chừng | LOW | Đã có trong PROJECT |

#### 8. Balance tooling & telemetry

| ID | Feature | Why Expected | Complexity | Notes |
|----|---------|--------------|------------|-------|
| T1 | Headless sim chạy N ván, báo cáo phân phối kết thúc theo số người, có/không có kẻ phản bội, độ khó, kèm khoảng tin cậy | Cổng "không kết thúc nào >40%" không thể kiểm bằng 30 ván người (xem Balance Targets) | MEDIUM | Dùng chung chính sách bot với L4 |
| T2 | Replay bất kỳ ván nào theo seed + event log | Để debug và soi ván lạ | LOW | Gần như có sẵn nếu làm event sourcing |
| T3 | Log playtest thật + khảo sát 1 phút sau ván | Slay the Spire dựng metrics server ghi mọi quyết định từ lúc còn prototype. Không có dữ liệu thì "vui không" chỉ là cảm giác | LOW | Danh sách cần log ở mục Balance Targets & Playtest Telemetry |

### Differentiators (Competitive Advantage)

Bám Core Value: *"balo và xúc xắc công khai tạo ra câu chuyện riêng và sự nghi ngờ lẫn nhau"*. Không cố khác biệt ở mọi thứ.

| ID | Feature | Value Proposition | Complexity | Notes |
|----|---------|-------------------|------------|-------|
| D1 | **Balo là lời khai**: engine lọc sự kiện theo thẻ (tag) đồ mà nhóm tại điểm đang mang; AI nhắc đúng đồ đó trong lời kể | Không game nào trong nhóm so sánh nối balo với truyện: Backpack Battles và Backpack Hero không có truyện, AI Dungeon và Hidden Door không có kho đồ thật (Hidden Door bị chấm 1/5 "Mechanical Depth") | MEDIUM | Cần tag nhất quán giữa đồ và thẻ |
| D2 | **"Vì sao thua" có phản thực tế**: "Thiếu 2 điểm; nếu có Xẻng (+3) đã qua" | Biến thất bại thành bài học về balo, gắn quyết định xếp đồ với kết quả. Trả lời trực tiếp rủi ro "random bị cảm nhận là bất công" | LOW | Engine tự tính được từ itemBonus của thẻ |
| D3 | **Nhiễu nghi ngờ**, kiểu Destiny Deck của Battlestar Galactica: sự cố "trông như phá hoại" (đồ mất ở trại, thuyền hư, manh mối sai) xảy ra cả khi không có kẻ phản bội, và hành động phá của kẻ phản bội ra đúng dạng đó | BSG trộn 2 lá ngẫu nhiên vào mỗi lần kiểm tra để không ai biết thất bại là do xui hay do Cylon. Không có nhiễu thì ván 0 kẻ phản bội hết nghi ngờ, còn ván 1 kẻ phản bội thì lộ quá dễ. Đây là thứ giữ cho luật "0 hoặc 1" sống được | MEDIUM | Cần thẻ "sự cố không rõ nguyên nhân" với tần suất cơ bản; bot sim đo xem nhiễu có che được hành động phá không |
| D4 | Lời kể riêng theo nhân vật (xuất thân, tật xấu, dòng tự mô tả) + sự kiện đêm riêng khi ngủ ngoài | Mỗi người có một mẩu truyện chỉ mình biết. Đây là nguyên liệu để nói dối hoặc để khoe | MEDIUM | Gọi song song, có lời văn mẫu dự phòng |
| D5 | Lời kể hoàng hôn nối các nhóm tách đoàn thành một câu chuyện | Khi chia nhóm, lời kể chung là chất keo kéo cả đội về một mạch | MEDIUM | Chỉ từ dữ liệu công khai |
| D6 | Biên niên sử một trang (tên đoàn, kết thúc, khoảnh khắc đáng nhớ, ai là kẻ phản bội) + **nút sao chép** | Thư viện ảnh (Gallery) của Jackbox và biên niên sử có minh hoạ của Tabled cho thấy recap là thứ người chơi mang đi khoe. Nút sao chép chữ gần như không tốn gì mà vẫn thử được vòng lan truyền khi chưa có thẻ ảnh | LOW | Thẻ ảnh vẫn ngoài phạm vi (PROJECT) |
| D7 | Màn lật bài có dòng thời gian "đêm đó thật ra đã xảy ra gì" | Bản nâng cấp của H7: kể lại từng đêm theo góc nhìn kẻ phản bội | MEDIUM | Từ event log |
| D8 | **Lục soát có giá**, kiểu Sheriff of Nottingham: lục balo người vô tội thì người lục bị phạt | Trong Sheriff of Nottingham, lục người thật thà thì Sheriff phải đền. Lục soát không mất gì thì ai cũng lục mọi người mọi đêm | LOW | Tài liệu nhắc "lục soát thông thường" nhưng chưa định nghĩa. Cần chốt ở phase vai ẩn |
| D9 | Đạo diễn độ căng chọn thẻ theo tình trạng đội, có nhịp nghỉ, **không động vào xúc xắc** | Left 4 Dead: build up → sustain peak → peak fade → relax 30–45 giây. Storyteller Cassandra của RimWorld: tăng dần, đẩy mạnh rồi cho thở. Cả hai chỉnh *cái gì xảy ra*, không chỉnh *kết quả* | MEDIUM | Ghi quyết định của đạo diễn vào log để kiểm (T3) |
| D10 | Nút ⭐ "khoảnh khắc hay" trong lúc chơi | Vừa là dữ liệu playtest vừa là nguyên liệu cho biên niên sử. John Hopson (games user research) khuyên thu phản hồi ngay giữa buổi chơi | LOW | P2 |
| D11 | Một bộ chính sách bot dùng cho cả người rời ván (L4) lẫn bot sim (T1) | Viết một lần dùng hai nơi, và bot sim kiểm luôn đường đi của bot | LOW | Hệ quả kiến trúc, người chơi không thấy |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Người chơi gõ tự do cho AI và chữ đó ảnh hưởng kết quả (kiểu AI Dungeon) | Cảm giác "làm gì cũng được" | Phá nguyên tắc engine quyết định; mở đường prompt injection; mỗi lượt gõ lại chờ LLM; không cân bằng hay test được | Engine đưa 2–4 lựa chọn; chat và dòng tự mô tả chỉ là chất liệu giọng văn |
| AI tự sinh sự kiện, đồ, hay định đoạt kết quả lúc chạy | "Nội dung vô hạn" | Không cân bằng, không test, không mô phỏng được. Hidden Door chạy từ thẻ viết sẵn chính để tránh "failure mode that defines this entire category" | Thẻ và đồ là dữ liệu có schema; AI chỉ chọn trong danh sách engine cho phép |
| Lén chỉnh xúc xắc cho đỡ cay (kiểu "aim assist" ẩn của XCOM 2) | Giảm cảm giác xui | Xúc xắc ở đây công khai nên chỉnh lén sớm muộn bị phát hiện, mất niềm tin; bot sim cũng hết đúng | Đạo diễn chọn thẻ (D9). Nếu cần bù xui thì làm **công khai**, ví dụ "Quyết tâm +1" sau 2 lần trượt liên tiếp (v1.x) |
| Người xem (spectator/audience) | Jackbox có audience, bạn bè muốn ngồi xem | Người xem nghe voice call mà biết vai là lộ bí mật; phức tạp quyền xem; nhóm 4–6 người không cần | Chỉ người chết mới thành hồn ma, xem phần công khai (H6) |
| Vào giữa ván | Bạn đến muộn | Nhân vật, balo và cân bằng đều đã chốt; vai đã chia | Chỉ vào được trong sảnh hoặc lúc tạo nhân vật; sau đó bot giữ chỗ |
| Loại hẳn người chơi (chết là nghỉ) | Werewolf cổ điển làm vậy | 40 phút ngồi xem giết không khí nhóm bạn; nhóm nhỏ càng nặng | Hồn ma và người bị trói vẫn có việc làm (H6); hạn chế chết trước ngày 4 (mục tiêu trong bot sim) |
| Báo ngay "trói đúng/sai" (Confirm Ejects) | Rõ ràng, thoả mãn ngay | Giết luật "0 hoặc 1 kẻ phản bội" và làm kết thúc "Lật mặt" hết bất ngờ | Hệ quả gián tiếp; lật hết ở màn cuối (H8) |
| Thêm vai đặc biệt, hoặc 2 kẻ phản bội khi 4–6 người | "Nhiều vai thì vui hơn" | Hướng dẫn cân bằng của werewolv.es: với nhóm nhỏ hãy "start even simpler than you think you need to", chỉ một vai thêm đã làm lệch cả ván | Giữ 4 vai như tài liệu; cân bằng bằng xác suất có kẻ phản bội và độ mạnh năng lực |
| Chat riêng 1-1 giữa người chơi trong game | Wolvesville và Town of Salem có | Chỉ có một kẻ phản bội nên không có phe cần phối hợp; nhóm bạn đằng nào cũng nhắn Zalo riêng; tách nhỏ cuộc thảo luận ban đêm | Kênh chung + kênh riêng từ GM. Trao đổi đồ là cách tương tác riêng duy nhất |
| Voice chat, TTS đọc lời kể, ảnh AI | Nhập vai hơn | Tốn chi phí, tăng độ trễ; voice nằm ngoài phạm vi; nhóm đã có Discord/Zalo call | Chữ ngắn; thiết kế timer cho nhóm dùng voice ngoài game |
| Chế tạo đồ, xây trại (kiểu Raft/Sons of the Forest) | Thể loại survival hay có | Phình phạm vi, lệch khỏi câu hỏi "mang gì, tin ai" | Hành động ở trại cố định: sửa thuyền, nấu ăn, canh gác |
| Tự động xếp balo | Tiện | Giết câu đố xếp đồ, là một trong hai trụ của game | Khay tạm + xoay nhanh; tối đa chỉ có "gom đồ về khay" |
| Undo sau hành động có hệ quả | Lỡ tay | Bị lợi dụng (xem kết quả rồi hoàn tác); phức tạp event log | Chỉ được undo trong pha xếp balo, trước khi hết giờ |
| Đồng hồ thời gian thực cho di chuyển ban ngày trong bản chữ | Giống bản 3D | Bản chữ không có di chuyển để "chơi", đồng hồ thật chỉ ép người ta đọc vội lời kể; 6 người khác tốc độ đọc | Quỹ giờ mặt trời + timer pha mềm (đủ người sẵn sàng là sang pha). Chốt ở discuss-phase (MEDIUM) |
| Tài khoản, bảng xếp hạng, thống kê toàn cục | Có vẻ chuyên nghiệp | Ngoài phạm vi PROJECT; không giúp trả lời "vui không" | Token phiên + log playtest cục bộ |

## Feature Dependencies

```
[Engine core: state + seeded PRNG + action validation (R4)]
    ├──requires──> [Content schema + validator (C3)]
    │                  └──feeds──> [Items] [Event cards] [Backgrounds/Flaws] [Fallback texts]
    └──enables───> [Event log / event sourcing]
                       ├──enables──> [Reconnect L3] [Server-restart recovery L7]
                       ├──enables──> [Roll history R3] ──> [End reveal H7/D7]
                       ├──enables──> [Fact ledger] ──> [AI consistency A6] ──> [Chronicle D6]
                       └──enables──> [Replay by seed T2] [Playtest telemetry T3]

[Per-player view filtering on server]
    └──required by──> [Role reveal H1] [Private channel H2] [Secret compartment B6]
                      [Night actions H3] [Private narration D4] [Reconnect snapshot L3]

Luồng một ván (phase sau phụ thuộc phase trước):
[Lobby L1/L2/L5/L6] → [Character creation] → [Shop + Backpack B1–B8]
    → [Node map + sun hours S3/S4] → [Event cards + public dice R1/R2/D2]
    → [Dusk S6/D5] → [Night H3/H4/H5] → [Endings] → [Reveal H7] → [Chronicle D6]

[Bot policies] ──enables──> [Zombie bot L4] và [Headless sim T1]   (D11)
[Grid placement logic B1] ──reused by──> [Trading] [Loot pickup] [Item loss]
[AI adapter + timeout + fallback A2] ──required by──> [Shared/private narration] ──> [Dusk recap D5] ──> [Chronicle D6]
[Card tags + difficulty tiers] ──required by──> [Tension director D9] ──verified by──> [T1/T3]
[Item tags] ──required by──> [Bag-as-testimony D1] [Counterfactual D2]
["Unexplained incident" cards] ──required by──> [Suspicion noise D3]

[Suspicion noise D3] ──conflicts──> [Confirm-on-tie-up]            (xem H8)
[Spectators] ──conflicts──> [Secrets protected by architecture]      (lộ qua voice)
[Freeform player input to AI] ──conflicts──> [Engine decides]
[Real-time day clock] ──conflicts──> [Reading AI narration at leisure]
[Ending "Kẻ sống sót duy nhất" (thắng cá nhân)] ──tension──> [Co-op incentives of loyal players]
```

### Dependency Notes

- **Mọi thứ phụ thuộc engine xác định + event log.** Reconnect, khôi phục sau restart, màn lật bài, biên niên sử, replay và telemetry đều đọc cùng một event log. Phải làm nó trước, không để "thêm sau".
- **Lọc góc nhìn theo người chơi là điều kiện của mọi bí mật.** Vai ẩn, ngăn bí mật, lời kể riêng và hành động đêm đều cần server gửi dữ liệu khác nhau cho từng người. Làm sai ở đây thì phải viết lại cả lớp mạng.
- **Bot là một thành phần, dùng hai nơi.** Bot giữ nhân vật cho người rời ván (L4) và bot mô phỏng (T1) nên dùng chung interface chính sách. Làm bot sim trước thì L4 gần như có sẵn.
- **Logic đặt đồ vào lưới dùng lại cho trao đổi, nhặt đồ, mất đồ.** Trao đổi đòi người nhận còn chỗ, tức là mở luồng đặt đồ phía người nhận. Nên giới hạn trao đổi ở trại (hoàng hôn hoặc đêm) cho v1.
- **D3 (nhiễu nghi ngờ) cần nội dung, không chỉ code.** Phải có thẻ "sự cố không rõ nguyên nhân" với tần suất cơ bản, và hành động phá của kẻ phản bội phải ra đúng cùng dạng. Mâu thuẫn trực tiếp với xác nhận trói đúng/sai.
- **Kết thúc "Kẻ sống sót duy nhất" tạo động cơ ích kỷ cho cả phe đội.** Nếu người thường có thể thắng một mình khi để người khác chết, game trượt sang kiểu Nemesis (ai cũng vì mình). Đây có thể là chủ ý, nhưng phải để bot sim đo và bàn ở discuss-phase.
- **Người bị trói hoặc kẻ phản bội bị trói phải còn việc để làm.** Nếu trói là vĩnh viễn thì thành loại người chơi. Gợi ý: trói kéo dài 1 ngày hoặc tới khi cả đội bỏ phiếu thả; kẻ phản bội bị trói mất năng lực N đêm chứ không phải mất hẳn. Cần chốt.

## MVP Definition

### Launch With (v1)

Khớp phạm vi v1 trong PROJECT.md; mỗi mục ghi **phiên bản tối thiểu** đủ để trả lời "có vui không".

- [ ] **Lobby & session:** L1–L8. Kick và pause ở mức đơn giản. Bot người rời ở mức "ở trại, pass"
- [ ] **Tạo nhân vật đầy đủ** như PROJECT, với **≥8 xuất thân và ≥8 tật xấu** (hoặc ít nhất ≥6 tật xấu) để 6 người không buộc phải trùng
- [ ] **Balo:** B1–B8. Hiệu ứng kề cạnh v1 chỉ **4–6 cặp**; hao mòn v1 chỉ gồm thức ăn hỏng + dụng cụ có số lần dùng; trao đổi chỉ ở trại; tham số "vùng dùng được" của lưới chỉnh được qua config
- [ ] **Đảo & ngày:** S1–S8, lên kế hoạch đồng thời, sự kiện song song theo nhóm, cảnh báo giờ về trại
- [ ] **Xúc xắc:** R1–R5 + D2 (phản thực tế "nếu có X đã qua"), vì nó rẻ và đánh thẳng vào rủi ro "random bất công"
- [ ] **Vai ẩn:** H1–H8, 4 vai, xác suất có kẻ phản bội cấu hình được; mọi người đều có hành động đêm; bỏ phiếu chỉ khi có đề cử
- [ ] **Nhiễu nghi ngờ D3** ở mức tối thiểu: 4–6 thẻ sự cố không rõ nguyên nhân
- [ ] **AI:** A1–A7 + lời kể riêng D4 + lời kể hoàng hôn D5; lời văn mẫu dạng template có slot
- [ ] **8 kết thúc + màn lật bài H7 + biên niên sử chữ D6 có nút sao chép**
- [ ] **Nội dung:** mức "tối thiểu cho 1 ván không lặp" ở bảng Content Volume Estimate
- [ ] **Bot sim T1 + replay T2 + telemetry và khảo sát T3**

### Add After Validation (v1.x)

- [ ] **Lưu ván để chơi tiếp buổi sau.** Làm khi playtest cho thấy nhóm thường không chơi hết 10 ngày trong một buổi. Event sourcing đã làm việc này rẻ đi
- [ ] **Bù xui công khai** ("Quyết tâm +1" sau 2 lần trượt). Làm khi khảo sát báo "xúc xắc bất công" dù đã có R1/R2/D2
- [ ] **Khảo sát nghi ngờ riêng mỗi đêm** ("bạn nghi ai?"), dùng cho dữ liệu và cho màn lật bài ("đêm 4, 3/5 người đã nghi đúng"). Làm khi cần biết nhóm bắt đầu nghi đúng từ lúc nào
- [ ] **Nút ⭐ khoảnh khắc (D10)** và **dòng thời gian đêm của kẻ phản bội (D7)** ở mức đầy đủ
- [ ] **Mở rộng nội dung** lên mức "tươi 2–3 buổi". Làm khi nhóm đòi chơi ván 2, 3
- [ ] **Hồn ma có năng lực phong phú hơn.** Làm khi telemetry cho thấy người chết sớm thoát khỏi ván hoặc im lặng
- [ ] **Chế độ chạm cho điện thoại** (chạm-chọn / chạm-đặt). Làm khi nhóm test chủ yếu dùng điện thoại

### Future Consideration (v2+)

- [ ] **Client 3D Unity, easter egg, đồ hiện trên người.** Thuộc milestone Graybox trở đi
- [ ] **Thẻ ảnh chia sẻ biên niên sử, analytics, kiểm duyệt nội dung.** Thuộc closed beta, khi có người lạ chơi
- [ ] **Spectator/audience, tài khoản, bảng xếp hạng.** Chỉ có ý nghĩa khi có cộng đồng
- [ ] **TTS, ảnh AI, voice.** Chi phí và độ trễ; phải chứng minh vòng chơi vui trước
- [ ] **Công cụ tạo thẻ cho cộng đồng, song ngữ.** Mở rộng

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Event log + engine xác định (nền của L3/L7/H7/T2) | HIGH | MEDIUM | P1 |
| Lọc góc nhìn theo người chơi (H2) | HIGH | MEDIUM | P1 |
| Mã phòng + link + token (L1/L2) | HIGH | LOW | P1 |
| Reconnect đúng ván (L3) | HIGH | MEDIUM | P1 |
| Bot giữ người rời (L4) | MEDIUM | MEDIUM (LOW nếu dùng lại bot sim) | P1 |
| Lưới balo kéo thả/xoay/bắt dính (B1–B4) | HIGH | MEDIUM | P1 |
| Hiệu ứng kề cạnh khi hover (B5) | MEDIUM | MEDIUM | P1 (chỉ 4–6 cặp) |
| Bản đồ điểm + chi phí về trại (S3) | HIGH | MEDIUM | P1 |
| Kế hoạch đồng thời + sự kiện song song (S4/S5) | HIGH | MEDIUM | P1 |
| Xúc xắc công khai có phân rã + % trước khi chọn (R1/R2) | HIGH | LOW | P1 |
| "Vì sao thua" phản thực tế (D2) | HIGH | LOW | P1 |
| Hành động đêm cho mọi người + thời lượng cố định (H3) | HIGH | MEDIUM | P1 |
| Bỏ phiếu đồng thời, lật cùng lúc (H4) | HIGH | LOW | P1 |
| Hồn ma / người bị trói vẫn chơi (H6) | HIGH | MEDIUM | P1 |
| Màn lật bài (H7) | HIGH | MEDIUM | P1 |
| Engine chốt trước, AI kể sau + fallback (A1/A2) | HIGH | MEDIUM | P1 |
| Lời kể riêng + hoàng hôn (D4/D5) | HIGH | MEDIUM | P1 |
| Nhiễu nghi ngờ (D3) | HIGH | MEDIUM | P1 |
| Bot sim + báo cáo (T1) | HIGH (cho dev) | MEDIUM | P1 |
| Biên niên sử chữ + sao chép (D6) | MEDIUM | LOW | P1 |
| Lục soát có giá (D8) | MEDIUM | LOW | P2 (tuỳ luật lục soát được chốt) |
| Đạo diễn độ căng (D9) | MEDIUM | MEDIUM | P2 (v1 có thể là bảng độ khó theo hồi, thêm thích nghi sau) |
| Nút ⭐ khoảnh khắc (D10) | MEDIUM | LOW | P2 |
| Lưu và chơi tiếp buổi sau | MEDIUM | MEDIUM | P2 (v1.x) |
| Bù xui công khai | LOW | LOW | P3 |
| Chế độ chạm cho điện thoại | tuỳ nhóm test | HIGH | P3 (chốt thiết bị trước) |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Social deduction online (Among Us, Town of Salem, Wolvesville, BotC online) | Board game co-op/traitor (Dead of Winter, Betrayal, BSG, Robinson Crusoe) | Inventory games (Backpack Battles, Backpack Hero, RE4) | AI GM (Tabled, Friends & Fables, AI Dungeon, Hidden Door, Death by AI) | TEN TIDES approach |
|---------|------|------|------|------|------|
| Vào phòng | Mã 4–6 ký tự; Jackbox có QR | Không áp dụng | Không áp dụng | Tabled: một mã mời cho tối đa 6 người; Death by AI chạy trong Discord Activity | Mã + link, không tài khoản |
| Rớt mạng | Among Us không cho vào lại; ToS phạt người rời 5 phút | Không áp dụng | Không áp dụng | Tabled/Infinity DM chơi bất đồng bộ nên né được vấn đề | Vào lại đúng ván + bot giữ chỗ |
| Nhận vai | Màn reveal riêng khi bắt đầu | DoW: mục tiêu bí mật, khoảng 43–45% ván có kẻ phản bội; Betrayal: kẻ phản bội lộ giữa ván; BSG: chia vai 2 lần (có pha "sleeper") | Không áp dụng | Không áp dụng | Chia lúc đầu, 0 hoặc 1 kẻ phản bội, che mặc định |
| Hành động ẩn | Đêm cố định (ToS 37 giây) | BSG: đóng góp úp + Destiny Deck làm nhiễu | Không áp dụng | Không áp dụng | Ai cũng có hành động đêm + nhiễu nghi ngờ |
| Bỏ phiếu | Among Us: skip/hoà thì không ai bị loại, tuỳ chọn phiếu ẩn danh; BotC: đề cử rồi bầu công khai | DoW: bất kỳ ai khởi xướng exile; exile nhầm 2 người thì morale về 0 | Không áp dụng | Không áp dụng | Chỉ khi có đề cử; khoá đồng thời, lật công khai; hoà thì không trói |
| Loại người chơi | Among Us: hồn ma vẫn làm task; BotC: người chết vẫn nói, còn 1 phiếu | DoW: người bị exile nhận mục tiêu mới | Không áp dụng | Voyage: permadeath chung cả đội | Hồn ma + người bị trói vẫn có việc |
| Lật bài cuối | Among Us lộ impostor; BotC hay cùng xem lại grimoire | Betrayal: kẻ phản bội lộ khi haunt bắt đầu | Không áp dụng | Tabled: biên niên sử có minh hoạ | Lật vai + ngăn bí mật + dòng thời gian + xúc xắc quyết định |
| Hiển thị random | Không có xúc xắc | Xúc xắc/lá bài vật lý, ai cũng thấy | Không áp dụng | Tabled: server tung và kiểm toán; F&F: engine 5e | % trước khi chọn + phân rã + "vì sao thua" |
| Kho đồ | Không có | DoW: lá bài trên tay | Lưới nhỏ (Backpack Battles 12–14/63 ô; RE4 60–130 ô), xoay, kề cạnh, shop 5 món + reroll | F&F theo dõi kho đồ; Hidden Door chỉ kể suông | 16x16 + 3 giới hạn + ngăn bí mật + đồ nối vào truyện |
| Nhất quán truyện | Không áp dụng | Người đọc thẻ | Không áp dụng | AI Dungeon trôi trí nhớ; Hidden Door nhất quán nhờ thẻ viết sẵn nhưng người chơi ít quyền; Tabled đôi khi bịa | Engine là nguồn sự thật + sổ sự thật + kiểm tra hậu kỳ + lời văn mẫu |
| Dữ liệu cân bằng | Among Us công bố impostor thắng 57,69% (2020); BotC khoảng 600 ván Trouble Brewing lệch khoảng 1% | Người chơi tự tính xác suất trên BGG | Slay the Spire: metrics server từ lúc prototype | Không công bố | Bot sim hàng nghìn ván + telemetry playtest |

## Content Volume Estimate

### Số liệu từ các game tương tự

| Game | Nội dung | Mỗi ván dùng khoảng | Confidence |
|------|----------|---------------------|------------|
| Dead of Winter | 80 thẻ Crossroads, 20 Crisis, 10 mục tiêu chung, 24 mục tiêu bí mật + 10 phản bội + 10 exile | Rút 1 Crossroads mỗi lượt người chơi, chỉ kích hoạt khi đúng điều kiện, không kích hoạt thì xuống đáy bộ bài; 1 Crisis mỗi vòng | HIGH (số thẻ), LOW (số lần rút mỗi ván là ước lượng) |
| Betrayal at House on the Hill | 45 event, 22 item, 13 omen, 50 haunt | Rút theo phòng khám phá; haunt bắt đầu theo số omen đã rút | HIGH (số thẻ) |
| Slay the Spire | 52 event (12 chỉ hồi 1, 16 chỉ hồi 2, 8 chỉ hồi 3, 16 dùng chung) | Mỗi event tối đa 1 lần mỗi lượt chơi; ước khoảng 10–15 event mỗi lượt | HIGH (số event), LOW (số mỗi lượt) |
| Eldritch Horror | 272 location encounter (tính cả bản mở rộng) | Theo vùng màu | MEDIUM |
| Backpack Battles | Shop bày 5 món mỗi vòng, reroll 1 vàng × 4 lần rồi 2 vàng, giữ chỗ được | Không áp dụng | HIGH |
| Tài liệu TEN TIDES | Prototype giấy: 30 thẻ; MVP 3D: 60 thẻ gắn điểm, 40 đồ | Không áp dụng | Nguồn nội bộ |

**Quy tắc ngón tay cái (MEDIUM-LOW, suy luận):** các game trên có kho khoảng **3 lần** số lần rút mỗi ván thì chơi nhiều buổi vẫn thấy mới. Để một ván không lặp mà vẫn có lựa chọn, kho cần tối thiểu khoảng **1,5 lần** số lần rút, vì bộ lọc (vùng × hồi × thời tiết × đồ mang theo) chia kho ra nhiều ngăn nhỏ.

### Ước lượng số lần rút mỗi ván TEN TIDES (LOW, cần bot sim đo)

- **Ban ngày:** 4–6 người thường chia 2–3 nhóm. Với khoảng 3 phút khám phá mỗi ngày và 30–60 giây mỗi thẻ ở bản chữ, mỗi nhóm gặp khoảng 1,5–2 thẻ mỗi ngày → 3–6 thẻ điểm mỗi ngày → **30–60 thẻ điểm mỗi ván** 10 ngày.
- **Ngoài điểm:** bình minh/trại 5–8, ngủ ngoài 2–5, tật xấu khoảng 1 mỗi người (4–6), twist ngày 5: 1.
- **Tổng khoảng 45–80 lần rút mỗi ván**, nhưng mỗi người **trực tiếp** gặp chỉ khoảng 15–25 thẻ vì các nhóm tách nhau. Cảm giác lặp vì vậy thấp hơn con số tổng.

### Khuyến nghị khối lượng

| Loại nội dung | Tối thiểu cho 1 ván không lặp (v1) | Mục tiêu tươi 2–3 buổi | Ghi chú |
|---------------|-----------------------------------|------------------------|---------|
| Thẻ sự kiện tại điểm (4 vùng) | **60** (khoảng 15 mỗi vùng, phần lớn dùng được ở nhiều hồi) | 100–120 (25–30 mỗi vùng) | Mỗi ô (vùng × hồi) cần ≥6–8 thẻ hợp lệ sau khi lọc, nếu không bộ rút sẽ cạn hoặc lặp |
| Thẻ trại / bình minh / hoàng hôn | 10 | 20 | |
| Sự kiện đêm khi ngủ ngoài | 6–8 | 12–15 | |
| Sự kiện tật xấu | 2 mỗi tật xấu | 3–4 mỗi tật xấu | |
| Twist ngày 5 | **3** | 5–6 | Người chơi nhớ twist; lặp lại ở buổi 2 là mất bất ngờ |
| Thẻ "sự cố không rõ nguyên nhân" (D3) | 4–6 | 8–10 | Dùng chung dạng với hành động phá của kẻ phản bội |
| Hành động phá / lừa của mỗi vai phản bội | 4–6 | 8 | |
| Đồ | 30–40 (cửa hàng bày khoảng 60–70% mỗi ván) | 50–60 | Tài liệu MVP đặt 40 |
| Xuất thân | 6 hiện có → **khuyến nghị 8** | 8–10 | Để 6 người vẫn có lựa chọn |
| Tật xấu | 5 hiện có → **tối thiểu 6, khuyến nghị 8** | 8–10 | 5 tật xấu với 6 người là buộc trùng |
| Vai | 4 | 4 (đừng thêm) | Nhóm nhỏ: đơn giản hơn bạn nghĩ |
| Lời kết | 8 kết thúc × biến thể theo vai phản bội | | |
| Lời văn mẫu dự phòng | Template có slot (tên, đồ, kết quả) cho mỗi thẻ | Mẫu viết tay cho thẻ quan trọng | 60 thẻ × khoảng 2,5 lựa chọn × 2 kết quả ≈ 300 đoạn nếu viết tay từng đoạn. Dùng template để giảm tải |

## Balance Targets & Playtest Telemetry

### Tham chiếu tỷ lệ thắng

| Nguồn | Số liệu | Confidence |
|-------|---------|------------|
| Blood on the Clocktower (Steven Medway) | Khoảng 600 ván Trouble Brewing lệch khoảng 1% giữa hai phe; nếu hai phe chơi ngang nhau thì 50/50 | HIGH (blog chính thức) |
| Secret Hitler | 580 ván, lệch hơn 1% một chút; phe Liberal chơi đúng meta thì thắng khoảng 70% | MEDIUM |
| Among Us | Impostor thắng 57,69%, crew 42,31% (tweet chính thức năm 2020) | MEDIUM (số cũ) |
| Town of Salem | Town khoảng 37–53% tuỳ chế độ (số liệu người chơi tự ghi) | LOW |
| Co-op, ván đầu (League of Gamemakers khảo sát designer) | Pandemic (Leacock) 40%; Castle Panic 40%; Mice and Mystics 70%; Mike Selinker 75% ("people don't like losing anywhere near as much as they say") | MEDIUM |
| Xác suất có kẻ phản bội | Dead of Winter khoảng 43–45% (luật chuẩn), 75–83% (biến thể); Shadows over Camelot bằng n/8 (4 người 50%, 5 người 62,5%, 6 người 75%) | MEDIUM |

### Mục tiêu đề xuất cho bot sim (LOW, là điểm xuất phát để chỉnh)

- **Cổng của tài liệu:** không kết thúc nào vượt 40% trên toàn bộ ván (trộn cả ván có và không có kẻ phản bội).
- **Mọi kết thúc đều phải xảy ra được:** mỗi kết thúc ≥1–2%. "Kẻ sống sót duy nhất" nên hiếm (2–8%).
- **Nhóm "phe đội thắng"** (Kho báu về tay + Kho báu nhuốm máu + Lật mặt kẻ phản bội): 45–60%. Nhóm bạn chơi lần đầu nên nghiêng về phía 50–55%.
- **Nhóm "không ai thắng"** (Tay trắng trở về + Chôn vùi cùng hòn đảo): 15–30%.
- **Kẻ phản bội thắng, tính riêng các ván có kẻ phản bội:** 30–45%. Thấp hơn 50/50 của game hai phe vì phe đội còn phải chống cả hòn đảo, nhưng đủ cao để vai phản bội thấy mình có cửa.
- **Xác suất có kẻ phản bội:** cấu hình được. Điểm khởi đầu nên theo kiểu Shadows over Camelot (4 người 50%, 5 người khoảng 60%, 6 người khoảng 70–75%); không ai kể cả chủ phòng biết con số thực của ván.
- **Nhịp:** ≥60–70% ván chạy tới ngày 10 để có cao trào núi lửa; ≤10% ván kết thúc trước ngày 6; cái chết đầu tiên hiếm khi xảy ra trước ngày 4.
- **Từng phép kiểm tra:** tỷ lệ thành công ở chỉ số điển hình nằm trong 25–85%. Ngoài khoảng đó thì đánh dấu để xem lại.

**Bot sim không đo được khả năng suy luận.** Bot chỉ đo độ khó của hòn đảo và sức mạnh của năng lực phản bội. Cách làm: cho bot phe đội một tham số "độ chính xác nghi ngờ" q (xác suất bầu đúng khi có tín hiệu), quét q ∈ {0,2; 0,4; 0,6}. Dải thắng của kẻ phản bội phải đứng vững ở q khoảng 0,3–0,5, mức của một nhóm bạn bình thường.

**Vì sao 30 ván người không đủ để kiểm cổng 40%:** với p = 40% và n = 30, khoảng tin cậy 95% là ±17,5 điểm phần trăm, nên một kết thúc "thật ra 40%" có thể hiện ra từ 23% đến 57%. Ở n = 2.000 ván bot, khoảng này còn ±2,1 điểm. Vậy bot sim là cổng chính; 30 ván người chỉ để xác nhận hướng và đo "vui".

### Bot sim phải xuất ra

- Phân phối 8 kết thúc theo số người (4/5/6), có/không có kẻ phản bội, loại vai phản bội, độ khó, **kèm khoảng tin cậy**.
- Phân phối ngày kết thúc, ngày và nguyên nhân chết, số người chết mỗi ván.
- Đường cong trung bình theo ngày: tiến độ kho báu, núi lửa, độ bền thuyền, lương thực. So đường cong độ căng thực tế với mục tiêu của đạo diễn.
- Tần suất xuất hiện từng thẻ (tìm thẻ không bao giờ được rút) và tỷ lệ thành công từng lựa chọn.
- Tần suất mua và dùng từng món đồ (tìm đồ chết); % ô balo đã dùng; **giới hạn nào chạm trước** (ô / trọng lượng / xu).
- Tỷ lệ hành động phá của kẻ phản bội bị "che" bởi nhiễu (D3).
- Mọi ván đều replay lại được theo seed (T2).

### Telemetry cho playtest thật (để trả lời "có vui không")

**Hành vi (log tự động, không cần hỏi):**
1. **Nhóm có tự bắt đầu ván 2 trong cùng buổi không.** Đây là KPI chính theo Core Value.
2. Tỷ lệ chơi hết ván; ván bỏ dở thì bỏ ở ngày nào, pha nào.
3. Thời lượng từng pha và từng ngày so với mục tiêu (4–5 phút/ngày, 45–60 phút/ván).
4. **Thời gian chờ** của từng người: chờ AI, chờ người khác, chờ timer. Đây là sát thủ số một của nhịp co-op.
5. AI: độ trễ p50/p95 theo loại lời gọi, tỷ lệ dùng lời văn mẫu, tỷ lệ JSON sai schema, tỷ lệ bị kiểm tra nhất quán chặn.
6. Chat: số tin mỗi đêm và phân bố theo người (ai im lặng), số đề cử, số phiếu, trói đúng/sai, ngày đầu tiên có người nghi đúng.
7. Kiểu chia nhóm mỗi ngày: số lần đi một mình, số lần ngủ ngoài (chủ động hay vì hết giờ).
8. Số lần trao đổi đồ, lục soát, dùng reroll.
9. Xếp balo: thời gian dùng, % ô, % trọng lượng, % ngân sách, đồ mua mà không bao giờ dùng.
10. Tín hiệu bối rối: số lần mở lại tooltip, lịch sử xúc xắc, xem lại vai.
11. Rớt mạng, vào lại, bot tiếp quản.
12. Số lần bấm ⭐ khoảnh khắc (nếu có D10) và nó rơi vào loại sự kiện nào.

**Thái độ (khảo sát 1 phút sau ván, trong game):**
- Vui không (1–10); muốn chơi lại không (1–10). Hai câu mặc định mà các dịch vụ playtest như PlaytestCloud dùng.
- Khoảnh khắc đáng nhớ nhất (tự do, một dòng).
- Có lúc nào thấy xúc xắc hoặc AI bất công không? Lúc nào?
- Lời kể của AI: hay / nhạt / sai sự thật (1–5).
- Bạn nghi ai, từ ngày nào? So với sự thật ở màn lật bài.

## Sources

**Lobby & session**
- [Jackbox — Party Pack 9 features (kick, host reconnection pause 5 phút)](https://www.jackboxgames.com/blog/the-ability-to-kick-players-and-other-new-features-coming-to-party-pack-9) (HIGH)
- [Jackbox Support — How do I join a game](https://support.jackboxgames.com/hc/en-us/articles/15794759479959-How-do-I-join-a-game) (HIGH)
- [Gamepur — Among Us không cho vào lại ván đang chơi](https://www.gamepur.com/guides/can-you-rejoin-a-game-of-among-us-if-you-get-disconnected-answered) (MEDIUM)
- [Board Game Arena — Zombie Mode](https://en.doc.boardgamearena.com/Zombie_Mode) (HIGH)
- [Town of Salem Wiki — Rules / leaving penalty](https://town-of-salem.fandom.com/wiki/Town_of_Salem_Rules) (MEDIUM)
- [Secret Hitler Online (ShrimpCryptid) — lobby code hoặc link](https://github.com/ShrimpCryptid/Secret-Hitler-Online) (MEDIUM)

**Hidden roles & social deduction**
- [Among Us Wiki — Voting](https://among-us.fandom.com/wiki/Voting), [Ejection / Confirm Ejects](https://among-us.fandom.com/wiki/Ejection), [Ghost](https://among-us.fandom.com/wiki/Ghost) (MEDIUM)
- [Screen Rant — Among Us impostor 57,69% win rate](https://screenrant.com/among-us-impostor-crewmate-win-rate-stats/) (MEDIUM)
- [Blood on the Clocktower — Behind the Curtain #7: Balance](https://bloodontheclocktower.com/blogs/news/behind-the-curtain-7-balance) (HIGH)
- [BotC Wiki — Storyteller Advice](https://wiki.bloodontheclocktower.com/Storyteller_Advice) (HIGH)
- [Tommy Maranges — Game Balance in Secret Hitler](https://medium.com/@tommygents/game-balance-in-secret-hitler-1b33f9563746) (MEDIUM, lấy qua search snippet)
- [UltraBoardGames — Dead of Winter rules (exile, crossroads, crisis)](https://www.ultraboardgames.com/dead-of-winter/game-rules.php) (MEDIUM)
- [BGG — Dead of Winter custom probability of a betrayer](https://boardgamegeek.com/thread/1312006/custom-probability-of-a-betrayer-in-your-game) (MEDIUM)
- [Wikipedia — Shadows over Camelot (8 thẻ trung thành, 1 kẻ phản bội)](https://en.wikipedia.org/wiki/Shadows_over_Camelot) (MEDIUM)
- [Battlestar Galactica rulebook (Destiny Deck)](https://images-cdn.fantasyflightgames.com/ffg_content/Battlestar_Galactica/bsg-rulebook-web.pdf) (HIGH)
- [werewolv.es — How to Balance a Werewolf Game](https://werewolv.es/how-to-balance-a-werewolf-game) (MEDIUM)
- [League of Gamemakers — The Problems with Werewolf](https://www.leagueofgamemakers.com/the-problems-with-werewolf/) (MEDIUM)
- [Skeleton Code Machine — Hidden traitor](https://www.skeletoncodemachine.com/p/hidden-traitor) (MEDIUM)
- [Town of Salem Wiki — Phases](https://town-of-salem.fandom.com/wiki/Phases), [Wolvesville Wiki — Day](https://wolvesville.fandom.com/wiki/Day) (MEDIUM)
- [Sportskeeda / Among Us recommended settings](https://sportskeeda.com/esports/news-among-us-recommended-settings-streamers-use) (LOW)
- [Sheriff of Nottingham rules](https://ultraboardgames.com/sheriff-of-nottingham/game-rules.php) (MEDIUM)
- [Wikipedia — Betrayal at House on the Hill](https://en.wikipedia.org/wiki/Betrayal_at_House_on_the_Hill), [Betrayal Wiki — Rules](https://betrayalhouse.fandom.com/wiki/Rules) (MEDIUM)

**Co-op survival**
- [Dized — Robinson Crusoe Night Phase](https://rules.dized.com/game/eRQuAkuRQH6gRouwj4U-rw/4picV5agTfy9-ogCbHxGCQ/6-night-phase) (MEDIUM)
- [Don't Starve Wiki — Death / Ghost](https://dontstarve.fandom.com/wiki/Death) (MEDIUM)
- [Oregon Trail design (Format)](https://www.format.com/magazine/features/design/you-have-died-of-dysentery-oregon-trail-design) (LOW)

**Inventory / backpack**
- [Backpack Battles Wiki — Game Mechanics](https://backpackbattles.wiki.gg/wiki/Game_Mechanics) (MEDIUM)
- [Backpack Hero (Wikipedia)](https://en.wikipedia.org/wiki/Backpack_Hero), [Screen Rant — Backpack Hero bag space](https://screenrant.com/roguelike-backpack-hero-bag-space-inventory-management/) (MEDIUM)
- [Resident Evil Wiki — Attache Case](https://residentevil.fandom.com/wiki/Attache_Case), [ihobo — Game Inventories: RE4](https://blog.ihobo.com/2016/09/game-inventories-4.html) (MEDIUM)
- [Escape from Tarkov Wiki — Secure containers](https://escapefromtarkov.fandom.com/wiki/Secure_containers) (MEDIUM)
- [MobiusCode — Tetris-style drag & drop inventory](https://mobiuscode.dev/posts/Drag-&-Drop-Tetris-Inventory-System-in-Godot/) (LOW)

**Randomness & directors**
- [Shacknews — Sid Meier & Rob Pardo on probability and player psychology (GDC 2010)](https://www.shacknews.com/article/62807/sid-meier-and-rob-pardo) (MEDIUM)
- [bg3.wiki — Inspiration](https://bg3.wiki/wiki/Inspiration) (MEDIUM)
- [Disco Elysium Wiki — Skills (white/red checks)](https://discoelysium.wiki.gg/wiki/Skills) (MEDIUM)
- [XCOM 2 hidden aim assist (Steam discussions)](https://steamcommunity.com/app/268500/discussions/0/1471966894878495418/) (LOW)
- [Left 4 Dead Wiki — The Director](https://left4dead.fandom.com/wiki/The_Director), [Michael Booth — The AI Systems of Left 4 Dead](https://www.readkong.com/page/the-ai-systems-of-left-4-dead-michael-booth-valve-9664541) (MEDIUM)
- [RimWorld Wiki — AI Storytellers](https://rimworldwiki.com/wiki/AI_Storytellers) (MEDIUM)

**AI narration**
- [Arcanum RPGs — Every Multiplayer AI DM Compared (07/2026)](https://arcanumrpgs.com/blog/ai-rpg-with-friends/) (MEDIUM)
- [Arcanum RPGs — Tabled Review (08/2026)](https://arcanumrpgs.com/blog/tabled-review/), [tabled.gg](https://tabled.gg/) (MEDIUM)
- [Arcanum RPGs — Hidden Door Review (07/2026)](https://arcanumrpgs.com/blog/hidden-door-review/), [Hidden Door FAQ](https://www.hiddendoor.co/help/faq) (MEDIUM)
- [Friends & Fables](https://fables.gg/) (MEDIUM)
- [AI Dungeon — Memory System](https://help.aidungeon.com/faq/the-memory-system) (HIGH)
- [Discord — Playroom / Death by AI case study](https://discord.com/build-case-studies/playroom), [Playroom — How to play Death by AI](https://playroom.substack.com/p/how-to-play-death-by-ai-on-discord) (MEDIUM)
- [arXiv — Werewolf Arena (Google)](https://arxiv.org/abs/2407.13943), [arXiv — Beyond Survival: LLMs in social deduction (information isolation)](https://arxiv.org/html/2510.11389v1) (MEDIUM)
- [The Neural Base — LLM latency breaking immersion](https://theneuralbase.com/ai-for-gaming/learn/beginner/llm-latency-breaking-immersion/) (LOW)
- [Jackbox — Gallery / post-game sharing](https://support.jackboxgames.com/hc/en-us/articles/15794749416471-How-do-I-view-my-gallery-from-a-past-game-session-for-shirts-or-social-media-sharing) (HIGH)

**Content volume**
- [Dead of Winter components (Wikipedia / wiki)](https://en.wikipedia.org/wiki/Dead_of_Winter:_A_Cross_Roads_Game) (HIGH)
- [Betrayal card counts (45/22/13)](https://www.rpg.net/reviews/archive/10/10766.phtml) (MEDIUM)
- [Slay the Spire Wiki — Events](https://slaythespire.wiki.gg/wiki/Events) (MEDIUM)
- [Eldritch Horror Wiki — Location Encounter](https://eldritchhorror.fandom.com/wiki/Location_Encounter) (MEDIUM)

**Balance tooling & telemetry**
- [Game Developer — How Slay the Spire's devs use data to balance](https://www.gamedeveloper.com/design/how-i-slay-the-spire-i-s-devs-use-data-to-balance-their-roguelike-deck-builder), [GDC Vault — Metrics Driven Design and Balance](https://www.gdcvault.com/play/1025731/-Slay-the-Spire-Metrics) (MEDIUM)
- [League of Gamemakers — Win ratios in first-time cooperative play](https://www.leagueofgamemakers.com/win-ratios-in-first-time-cooperative-play/) (MEDIUM)
- [Boards and Barley — Monte Carlo simulations for game design](https://boardsandbarley.com/2013/09/17/monte-carlo-simulations-for-game-design/) (LOW)
- [PlaytestCloud — Default survey questions](https://help.playtestcloud.com/en/articles/1187190-default-survey-questions-five-star-ratings), [John Hopson — Mid-playtest feedback methods](https://medium.com/@john.hopson/mid-playtest-feedback-methods-319521c01e44) (MEDIUM)

---
*Feature research for: online co-op survival + hidden-traitor text prototype with LLM Game Master*
*Researched: 2026-09-25*
