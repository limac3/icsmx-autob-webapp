# Llaves de CloudFront

Las fotografias se sirven con **URLs firmadas**. Eso exige un par de llaves RSA: CloudFront
guarda la publica y la aplicacion firma con la privada en cada peticion SSR.

## Generar el par (una sola vez por entorno)

```bash
openssl genrsa -out cloudfront-privada.pem 2048
openssl rsa -pubout -in cloudfront-privada.pem -out amplify/claves/cloudfront-publica.pem
```

- `cloudfront-publica.pem` **se versiona**. Una llave publica no es un secreto, y tenerla
  fija en el repositorio es lo que mantiene estable el identificador de la llave: rotarla
  invalida de golpe todas las URLs firmadas que haya vigentes.
- `cloudfront-privada.pem` **nunca se versiona**. El `.gitignore` de esta carpeta lo impide.
  Se carga como secreto (`CLOUDFRONT_PRIVATE_KEY`) y en local va en `.env.local`.

Sin `cloudfront-publica.pem`, el backend falla al sintetizar con un mensaje explicito. Es
deliberado: una distribucion sin grupo de llaves de confianza serviria las fotografias a
cualquiera que conociera la URL.
