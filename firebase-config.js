/* Firebase の設定（オンライン対戦・ランキング・フレンド用）
   作り方は README の「オンライン対戦の準備」を見てください。
   Firebase コンソールの「プロジェクトの設定 → マイアプリ」にある firebaseConfig の中身をここに貼ります。
   この値は公開しても大丈夫なもの（データの守りは firestore.rules で行います）。
   null のままだとオンライン機能はオフになり、CPU戦・2人対戦・図鑑はそのまま使えます。 */
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBuedVzCCth-zob49HWnv11Nqny72OX8UY',
  authDomain: 'extremers-1e7b7.firebaseapp.com',
  projectId: 'extremers-1e7b7',
  storageBucket: 'extremers-1e7b7.firebasestorage.app',
  messagingSenderId: '391223142171',
  appId: '1:391223142171:web:24ed267b060a358071d5be',
};
/* 例：
window.FIREBASE_CONFIG = {
  apiKey: 'AIza...',
  authDomain: 'extremers-xxxx.firebaseapp.com',
  projectId: 'extremers-xxxx',
  storageBucket: 'extremers-xxxx.firebasestorage.app',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef',
};
*/
