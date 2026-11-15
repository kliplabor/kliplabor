# KlipLabor – Supabase beállítás lépésről lépésre

Ez az útmutató neked szól, nem kell hozzá programozni. Kb. 20–30 perc az egész.

> **A legfontosabb szabály:** a Supabase-ben két kulcs van. A **publishable** (nyilvános) kulcs már benne van a weboldalban (`assets/config.js`), az nyugodtan látszhat. A **secret** (titkos, régebben „service_role”) kulcsot **soha ne másold be sehova**: se a weboldalba, se chatbe, se e-mailbe, se Discordra, és senkinek ne add oda. Aki megkapja, minden adatot lát és módosíthat. Ha véletlenül kikerült, a Supabase-ben azonnal generálj újat (Project Settings → API Keys).

---

## 1. Az adatbázis létrehozása (egyszer kell)

1. Lépj be a Supabase-be, és nyisd meg a KlipLabor projektet.
2. Bal oldalt kattints az **SQL Editor** menüre, majd a **New query** gombra.
3. Nyisd meg a `supabase/schema.sql` fájlt (a weboldal mappájában), jelöld ki az egészet, másold ki, és illeszd be a Supabase szerkesztőbe.
4. Kattints a **Run** gombra (jobb alul).
5. Ha alul azt látod, hogy **Success. No rows returned**, kész. Ha piros hibaüzenet jön, másold ki a teljes szövegét, és kérj segítséget, ne próbálgass.

Ellenőrzés:
- **Table Editor** menü: látnod kell ezeket a táblákat: `profiles`, `campaigns`, `campaign_members`, `clips`, `clip_stats`, `payouts`, `streamer_applications`, `app_settings`. Mindegyik mellett „RLS enabled” jelzés legyen.
- **Storage** menü: legyen egy **screenshots** nevű bucket, és mellette „Private” (nem „Public”).

Ha később még egyszer lefuttatod a fájlt, az sem baj: a meglévő adatokat nem törli.

## 2. A címek beállítása (hogy működjenek az e-mailes linkek)

1. Bal oldalt **Authentication** → **URL Configuration**.
2. **Site URL**: `https://kliplabor.hu`
3. **Redirect URLs** résznél kattints az **Add URL** gombra, és add hozzá ezt a kettőt (egyenként):
   - `https://kliplabor.hu/**`
   - `https://kliplabor.github.io/**`
4. Mentsd el (**Save**).

Erre azért van szükség, mert a regisztráció megerősítő linkje és az „elfelejtett jelszó” link csak ezekre a címekre irányíthat vissza.

## 3. E-mail megerősítés bekapcsolva marad

1. **Authentication** → **Sign In / Providers** (régebbi felületen: **Providers**) → **Email**.
2. Az **Enable Email provider** legyen bekapcsolva.
3. A **Confirm email** maradjon **bekapcsolva**. Így csak az tud belépni, aki a saját, valódi e-mail címével regisztrált.

Fontos tudnivaló: a Supabase beépített e-mail küldője csak tesztelésre való, **óránként nagyon kevés e-mailt küld ki**. Az első tesztekhez elég, de mielőtt clippereket toborzol, állíts be saját e-mail küldőt: **Authentication** → **Emails** → **SMTP Settings** (például a domainedhez tartozó e-mail szolgáltatóval). Ugyanitt, az **Email Templates** résznél a levelek szövegét is átírhatod magyarra.

## 4. Regisztrálj a saját oldaladon

1. Nyisd meg a `https://kliplabor.hu/belepes.html#regisztracio` oldalt.
2. Regisztrálj a saját e-mail címeddel (ezzel leszel admin).
3. Nyisd meg a megerősítő e-mailt, és kattints a linkre. Ha nem jön, nézd meg a spam mappát (és lásd a 3. pont megjegyzését).

## 5. Tedd magad adminná

1. Supabase → **SQL Editor** → **New query**.
2. Másold be ezt a sort, és írd át benne az e-mail címet a sajátodra:

   ```sql
   update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'IDE@AZ-EMAILED.hu');
   ```

3. **Run**. Az eredmény alján ezt kell látnod: `Success. 1 row affected` (vagy „UPDATE 1”). Ha `0 rows`, akkor elírtad az e-mail címet, vagy még nem regisztráltál.
4. A weboldalon lépj ki, majd be újra. Mostantól az `admin.html` oldalon eléred a vezérlőpultot.

Adminná csak ezzel az SQL sorral lehet tenni valakit, a weboldalról nem. Másnak ne add meg ezt a jogot, hacsak nem bízod rá a kifizetéseket is.

## 6. Próbáld ki clipperként egy második e-mail címmel

1. Egy másik böngészőben vagy privát (inkognitó) ablakban regisztrálj egy második e-mail címmel (például egy régi címeddel).
2. Admin fiókkal az **admin.html** → **Kampányok** fülön hozz létre egy próba kampányt.
3. A clipper fiókkal: **Jelentkezem** a kampányra → **Klip beküldése** (egy valódi TikTok/Instagram/YouTube linkkel) → a klipnél **Heti statisztika** gomb → írj be egy számot, és tölts fel egy képernyőképet.
4. Admin fiókkal: **Klipek ellenőrzése** fül → látod a képet → írd be a hitelesített megtekintést → **Jóváhagyom**.
5. Nézd meg a clipper fiókban, hogy megjelent-e a kereset. Példa: 120 000 megtekintés = 18 000 Ft + 5 000 Ft bónusz = 23 000 Ft.
6. Admin fiókkal: **Kifizetések** fül → **Kifizetve** → **Rögzítem a kifizetést**. A clipper fiókban a „Kifizetésre vár” összeg erre lecsökken.
7. Próbáld ki a főoldal **Kérj ajánlatot** űrlapját is kijelentkezve; a jelentkezés az admin **Streamer jelentkezések** fülén jelenik meg.

A tesztadatokat a végén a **Table Editor**-ban törölheted (a próba kampánynál előbb a hozzá tartozó klipeket).

Ha a főoldali ajánlatkérő vagy a belépés „Invalid JWT” / „Lejárt a bejelentkezésed” jellegű hibát ad már az első próbánál, szólj: akkor az `assets/config.js`-ben a publishable kulcs helyett a régi, szintén nyilvános **anon** kulcsot kell beírni (Project Settings → API Keys → Legacy API Keys → `anon` `public`). A **service_role** kulcsot ilyenkor sem!

## 7. Az ingyenes csomag „elalszik”

Az ingyenes Supabase projekt kb. **egy hét tétlenség után szünetel** (paused). Ilyenkor az oldal belépés és űrlapok nélkül marad működőképes (a kalkulátor megy), de belépni és beküldeni nem lehet.

Visszaállítás:
1. Lépj be a Supabase-be, nyisd meg a projektet.
2. Kattints a **Restore project** gombra, és várj néhány percet.

Az adatok megmaradnak, de ne hagyd hónapokig szünetelni: hosszú szünet után a visszaállítás már nem biztos, hogy egy kattintás. Amíg vannak aktív clipperek, a napi használat ébren tartja a projektet. Ha élesben megy a rendszer, érdemes a fizetős csomagot megfontolni (az nem szünetel, és van automatikus mentés).

Mentés: időnként (pl. havonta) a **Table Editor**-ban minden táblát exportálj CSV-be (**Export → Export table as CSV**), és tedd el egy biztonságos helyre. A kifizetések CSV-je az admin oldalon is letölthető.

## 8. Mielőtt nyilvánosan elindulsz

- **Adatkezelési tájékoztató:** az `adatvedelem.html` most csak tervezet. Ügyvéddel véglegesíttesd, és töltsd ki a [..] helyeket (adatkezelő adatai, jogalapok, megőrzési idők, kapcsolat).
- **Régió:** a tájékoztató szerint az adatok az EU-ban, Frankfurtban vannak. Ellenőrizd: Supabase → **Project Settings** → **General** → **Region** legyen „Central EU (Frankfurt)”. Ha más, javítsd a tájékoztatót.
- **Clipper szabályzat:** a `szabalyzat.html` a 05-ös dokumentum tervezete. Az ügyvédi átnézés és a [DÖNTÉS] pontok után frissíteni kell (a 7. pont még űrlapot említ, ezt is írd át a beküldő felületre).
- **Könyvelő:** amíg nincs tisztázva a kifizetés módja és adózása, ne utalj, és ne vegyél át pénzt.
- **Impresszum:** a vállalkozás adatai kerüljenek fel az oldalra.
- **E-mail küldő:** saját SMTP beállítva (3. pont).
- **Közösségi linkek, e-mail cím:** az `assets/config.js` fájlban a `links` részt töltsd ki; az üres sorok nem jelennek meg.
- **A secret kulcs** soha nem került a weboldalba vagy nyilvános helyre.

## Ha valami nem működik

- „Nem sikerült elérni a szervert”: nézd meg, nem szünetel-e a projekt (7. pont).
- „Még nem erősítetted meg az e-mail címedet”: a regisztrált címre ment link még nincs megnyitva.
- „Ehhez nincs jogosultságod”: rossz fiókkal vagy belépve, vagy a 5. pont még nem történt meg.
- Admin oldalon „Nincs jogosultságod”: lépj ki és be újra az 5. pont után.
