import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";

type Verification = { provider: string; code: string };
type Tracking = { provider: string; tracking_id: string; enabled: boolean };

const VERIFICATION_META_NAME: Record<string, string> = {
  google: "google-site-verification",
  bing: "msvalidate.01",
  yandex: "yandex-verification",
  pinterest: "p:domain_verify",
  facebook: "facebook-domain-verification",
};

/**
 * Site-wide head: injects verification meta tags and tracking scripts
 * managed by admins via Painel ADM → SEO. Mount once near the app root.
 */
export function SeoHead() {
  const { data: verifications } = useQuery({
    queryKey: ["seo-verifications"],
    queryFn: async (): Promise<Verification[]> => {
      const { data, error } = await supabase
        .from("seo_verifications" as any)
        .select("provider, code");
      if (error) return [];
      return (data as any[]) ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: tracking } = useQuery({
    queryKey: ["seo-tracking-enabled"],
    queryFn: async (): Promise<Tracking[]> => {
      const { data, error } = await supabase
        .from("seo_tracking" as any)
        .select("provider, tracking_id, enabled")
        .eq("enabled", true);
      if (error) return [];
      return (data as any[]) ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const byProvider = (p: string) =>
    tracking?.find((t) => t.provider === p)?.tracking_id;

  const ga = byProvider("google_analytics");
  const gtm = byProvider("google_tag_manager");
  const fbPixel = byProvider("facebook_pixel");
  const tiktok = byProvider("tiktok_pixel");
  const linkedin = byProvider("linkedin_insight");
  const hotjar = byProvider("hotjar");
  const clarity = byProvider("clarity");

  return (
    <Helmet>
      {/* Verification meta tags */}
      {verifications?.map((v) => {
        const name = VERIFICATION_META_NAME[v.provider];
        if (!name || !v.code) return null;
        return <meta key={v.provider} name={name} content={v.code} />;
      })}

      {/* Google Tag Manager */}
      {gtm && (
        <script>{`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');`}</script>
      )}

      {/* GA4 */}
      {ga && (
        <script async src={`https://www.googletagmanager.com/gtag/js?id=${ga}`}></script>
      )}
      {ga && (
        <script>{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga}');`}</script>
      )}

      {/* Meta (Facebook) Pixel */}
      {fbPixel && (
        <script>{`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${fbPixel}');fbq('track','PageView');`}</script>
      )}

      {/* TikTok Pixel */}
      {tiktok && (
        <script>{`!function (w, d, t) {w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${tiktok}');ttq.page();}(window, document, 'ttq');`}</script>
      )}

      {/* LinkedIn Insight Tag */}
      {linkedin && (
        <script>{`_linkedin_partner_id = "${linkedin}";window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];window._linkedin_data_partner_ids.push(_linkedin_partner_id);(function(l) {if (!l){window.lintrk = function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}var s = document.getElementsByTagName("script")[0];var b = document.createElement("script");b.type = "text/javascript";b.async = true;b.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";s.parentNode.insertBefore(b, s);})(window.lintrk);`}</script>
      )}

      {/* Hotjar */}
      {hotjar && (
        <script>{`(function(h,o,t,j,a,r){h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};h._hjSettings={hjid:${hotjar},hjsv:6};a=o.getElementsByTagName('head')[0];r=o.createElement('script');r.async=1;r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;a.appendChild(r);})(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');`}</script>
      )}

      {/* Microsoft Clarity */}
      {clarity && (
        <script>{`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window, document, "clarity", "script", "${clarity}");`}</script>
      )}
    </Helmet>
  );
}
