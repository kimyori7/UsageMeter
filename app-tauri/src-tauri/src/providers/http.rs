// 주입 가능한 HTTP 전송 계층. 단위 테스트는 MockTransport, 실행은 ReqwestTransport(native-tls=schannel
// — 1단계 게이트로 기업 프록시 환경 통과 확정).
// 보안(설계 D4): send의 Err는 unit — 전송 오류 메시지를 나르지 않아 토큰·URL이 에러 경로로 샐 수 없다
// (v1 catch{} 동등).

pub struct HttpRequest<'a> {
    pub method: &'a str, // "GET" | "POST"
    pub url: &'a str,
    pub headers: &'a [(&'a str, &'a str)],
    pub body: Option<&'a str>, // JSON 문자열 (POST)
}

pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

pub trait Transport {
    fn send(&self, req: &HttpRequest) -> Result<HttpResponse, ()>;
}

pub struct ReqwestTransport {
    client: reqwest::blocking::Client,
}

impl ReqwestTransport {
    pub fn new() -> Self {
        Self { client: reqwest::blocking::Client::new() }
    }
}

impl Default for ReqwestTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl Transport for ReqwestTransport {
    fn send(&self, req: &HttpRequest) -> Result<HttpResponse, ()> {
        let mut builder = match req.method {
            "POST" => self.client.post(req.url),
            _ => self.client.get(req.url),
        };
        for (k, v) in req.headers {
            builder = builder.header(*k, *v);
        }
        if let Some(body) = req.body {
            builder = builder.body(body.to_string());
        }
        let res = builder.send().map_err(|_| ())?;
        let status = res.status().as_u16();
        let body = res.text().map_err(|_| ())?;
        Ok(HttpResponse { status, body })
    }
}

#[cfg(test)]
pub mod testing {
    // 단위 테스트 공용 mock — 준비된 응답을 순서대로 반환하고 요청을 기록한다. 실 네트워크 금지 계약의
    // 집행 지점: 프로바이더 테스트는 전부 이 타입만 쓴다.
    use super::*;
    use std::cell::RefCell;

    pub struct RecordedRequest {
        pub method: String,
        pub url: String,
        pub headers: Vec<(String, String)>,
        pub body: Option<String>,
    }

    pub struct MockTransport {
        responses: RefCell<Vec<Result<HttpResponse, ()>>>,
        pub requests: RefCell<Vec<RecordedRequest>>,
    }

    impl MockTransport {
        pub fn returning(status: u16, body: &str) -> Self {
            Self::with(vec![Ok(HttpResponse { status, body: body.to_string() })])
        }
        pub fn erroring() -> Self {
            Self::with(vec![Err(())])
        }
        pub fn with(responses: Vec<Result<HttpResponse, ()>>) -> Self {
            Self { responses: RefCell::new(responses), requests: RefCell::new(vec![]) }
        }
        pub fn call_count(&self) -> usize {
            self.requests.borrow().len()
        }
    }

    impl Transport for MockTransport {
        fn send(&self, req: &HttpRequest) -> Result<HttpResponse, ()> {
            self.requests.borrow_mut().push(RecordedRequest {
                method: req.method.to_string(),
                url: req.url.to_string(),
                headers: req
                    .headers
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect(),
                body: req.body.map(String::from),
            });
            let mut rs = self.responses.borrow_mut();
            if rs.is_empty() {
                Err(()) // 준비된 응답 소진 = 전송 실패로 취급
            } else {
                Ok(rs.remove(0)?)
            }
        }
    }
}
