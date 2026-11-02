# 設計メモ: なぜこう作ったか

**English summary:** Design notes for RC2014 BOM, a fork of [Eurorack BOM](https://github.com/Hei0MOrld/eurorack-bom/blob/main/DESIGN.md) for Z80 homebrew kits. What changed for this hobby: every line that comes in both mounting styles defaults to through-hole unless the line names a package, because RC2014 boards are through-hole; a part name with an extra word ("Z80 CPU") falls back to its part-number token, but only as a whole word or after a letters-only vendor prefix; an IC socket is judged by its pin count and nothing else; the part type comes from the reference designator first, with a few keywords allowed to override it because real tables are messy. Each rule came from a wrong pick seen in live Mouser/DigiKey results and is pinned as a regression test.

---

このメモは、README の「何ができるか」ではなく「なぜその作りにしたか」を書いたものです。
土台は [Eurorack BOM](https://github.com/Hei0MOrld/eurorack-bom) で、そちらの[設計メモ](https://github.com/Hei0MOrld/eurorack-bom/blob/main/DESIGN.md)と同じ考え方(間違った部品を自信ありげに出さない、一致は 3 段階のラベル、値 → 形状 → 価格の順)をそのまま使っています。
ここには、RC2014(Z80 の自作コンピューター)向けに変えたところだけを書きます。コードの場所は `lib/` 以下のファイル名で示します。

## 1. 何も書いていなければ、リード部品(スルーホール)として探す(`lib/bom-parser.ts` の `lineRequirement`)

RC2014 のキットとモジュールは、ほぼ全部が穴に差してはんだ付けする基板です。
ところが部品表には形状が書かれていないことが多く、最初の版は値だけで探していました。
その結果、実際の検索で次のような間違いが起きました。

- `100nf cap` の行に、0402(1mm 角の表面実装)のチップコンデンサが選ばれた
- `74HCT04` の行に、TSSOP(表面実装の細いIC)が選ばれた

どちらも「値は合っている」ので、値だけを見る作りでは `exact` になってしまいます。
そこで、抵抗・コンデンサ・IC・ダイオード・トランジスター・ポット・水晶のように両方の形状がある部品は、**行に形状が書かれていなければスルーホールを求める**ことにしました。
`SOIC-14` や `SMD` と書いてある行は、その指定に従います。
形状の判定そのもの(`lib/package.ts`)は、Eurorack BOM に外部のコントリビューター(@daaaaaaaaaniel)が入れてくれたものを移植しました。

ヘッダー・ジャック・スイッチ・ソケットは、初めからスルーホールで探しているので、この決まりの対象外です。

## 2. 検索の言葉にも「through hole」を足す(`lib/query-builder.ts`)

並べ替えで形状を見るだけでは足りませんでした。
`100nF capacitor` で検索すると、返ってくる結果のほとんどが表面実装のチップでした。そのため、結果の中で一番安いスルーホール品は ¥124 のフィルムコンデンサになっていました。
検索の言葉に `through hole` を足すと、¥50 前後の普通のリード付きセラミックが返ってきます。
「出てきた結果をうまく並べる」より前に、「正しい候補が結果に入るように聞く」ほうが効く、という例です。

## 3. 「Z80 CPU」は、型番の部分だけで探す。ただし言葉として一致したときだけ(`lib/match-ranker.ts` の `scoreBySubstring`)

部品表には `Z80 CPU` のように、型番に言葉が付いた書き方がよく出てきます。
この文字列全体は相手の説明に出てこないので、そのままでは全部が `unknown` になります。
そこで、英字と数字の両方を含む言葉(`Z80`)を型番として取り出して、もう一度照らし合わせます。

ただし、単純に「含んでいるか」で見ると別の問題が起きました。
実際の検索で、`Z80` がパワーインダクターの型番(`IHTL4020LZEZ80NL`)の途中に入っていて、それが選ばれたのです。
そのため、一致とみなすのは次の 2 つの場合だけにしました。

- 説明文の中で、前後が英数字でない「1 つの言葉」として出てくる(`IC 6MHZ Z80 NMOS CPU`)
- 型番の先頭が英字だけのメーカー記号で、そのすぐ後に続く(`74HCT04` に対する `SN74HCT04`)

この方法で見つかったものは `exact` ではなく `possible` にしています。型番の一部で当てたものは、確かめたとは言えないからです。

## 4. IC ソケットは、ピン数だけで判定する(`rankSockets`)

ソケットの行が書いていて確かめられるのは、ピン数(`40 pin DIP socket`)だけです。
最初は価格順だったので、実際の検索では 8 ピンのソケットや、ソケットですらない基板用コネクターのハウジングが上に来ていました。
今は、説明に `SOCKET` を含み(DIP スイッチは除く)、ピン数が一致するものだけを `possible` にしています。
`exact` にしないのは、丸ピンか板バネか、幅が 0.3 インチか 0.6 インチかまでは確かめていないからです。README の「Limitations」にも、ソケットは自分で見てほしいと書いています。

## 5. 部品の種類は、まず部品番号の頭文字で決める。ただし一部の言葉は優先する(`lib/bom-parser.ts`)

RC2014 系の部品表は `R5 | 1 | Resistor, 1k, 0.25W` のような表になっていて、頭文字(R・C・U・Q・D・X・J・P・SW・RP…)で種類がほぼ決まります。
なのでまず頭文字を使います。

ところが、実際に取ってきたページで、ソケットの行の部品番号の欄に `IC socket 20-pin U1` と書かれていた例がありました。
頭文字だけを見ると、これは IC の行になってしまいます。
そこで、`socket`・`crystal`・`jumper` などの言葉は頭文字より優先することにしました。
表はいつもきれいとは限らない、という前提です。

基板(`PCB`)の行は飛ばします。部品の店では売っていないからです。

## 6. 公式キットのページの書き方も読む

部品表の形式は、実際のページから 2 つ選びました。

- Small Computer Central のモジュールのページにある、部品番号・数量・部品の表(タブ区切りか `|` 区切り)
- RC2014 公式キットのページにある、`6 x 100nf cap` のような数量の箇条書き

後者には `.1UF` のような書き方も出てくるので、100nF として読めるようにしています(`lib/value-normalizer.ts`)。
水晶の `7.3728 Mhz` も周波数として読み、値で照らし合わせます。

## 7. DigiKey は 1 個から買える包装を選ぶ(`lib/digikey-client.ts` の `pickHobbyistVariation`)

DigiKey は同じ部品を、包装違い(リール・カットテープなど)で別々の最小注文数で返します。
実際に、100kΩ の抵抗で「リール、5,000 個から、1 個 ¥1.49」と「カットテープ、1 個から、¥17」が両方返ってきました。
一番目の包装を何も考えずに使うと、5,000 個のリールが選ばれます。
自作で 1 個だけ欲しい人には意味がないので、最小注文数が一番少ない包装を選ぶようにしています。

## 8. 間違いは、実際の検索結果のままテストに残す(`lib/__tests__/live-regressions.test.ts`)

上の 1・3・4 の間違いは、どれも作った時点で想像したものではなく、実際の Mouser・DigiKey の検索結果を見て見つけたものです。
そのため、その時の説明文をそのまま使ってテストにしています(0402 のコンデンサ、TSSOP の 74HCT04、Z80 を含むインダクター、8 ピンのソケットなど)。
直したあとで別の変更が同じ間違いを戻してしまっても、CI(GitHub Actions)で気づけます。テストは全部で 34 件です。

## やっていないこと

- スイッチ・ジャック・ヘッダーは、検索できる型番も数値もないので、いつも `unknown` です。価格順で選んだものを `exact` と呼ぶより、正直に「確かめていない」と出すほうが安全だからです。
- 元祖の Zilog の Z80(DIP)は、今の Mouser・DigiKey ではほとんど見つかりません。違う形状しかないときは、警告で知らせるだけにしています。
- DigiKey へ貼り付けるリストの形式は、まだ実際の DigiKey の取り込みで試していません。
