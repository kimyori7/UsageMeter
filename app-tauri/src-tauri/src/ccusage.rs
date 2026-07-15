// ccusage 사이드카 실행 — v1 main/ccusage-runner.ts 이식.
// v1은 npm 디스패처(asar 경로 문제)를 우회해 네이티브 exe를 직접 실행했다. v2는 같은 exe를
// Tauri externalBin으로 동봉하므로 항상 "앱 실행 파일 옆의 ccusage.exe"다 — 경로 치환 불필요.
// 모든 실패(스폰/타임아웃/비0 종료/비JSON)는 Err(()) — 에러 메시지를 만들지 않는다(출력 전문이
// 로그로 새는 경로 차단 — D4와 동일 원칙). 실패 시 폴러는 해당 provider만 건너뛴다(v1 격리 동일).
use serde_json::Value;
use std::io::Read;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use wait_timeout::ChildExt;

const TIMEOUT: Duration = Duration::from_secs(120); // v1 execFile timeout: 120_000ms
const CREATE_NO_WINDOW: u32 = 0x0800_0000; // v1 windowsHide — 콘솔 창 플래시 억제

pub fn ccusage_bin_path() -> Result<PathBuf, ()> {
    let exe = std::env::current_exe().map_err(|_| ())?;
    Ok(exe.parent().ok_or(())?.join("ccusage.exe"))
}

pub fn run_ccusage(bin: &Path, args: &[&str]) -> Result<Value, ()> {
    run_ccusage_with_timeout(bin, args, TIMEOUT)
}

fn run_ccusage_with_timeout(bin: &Path, args: &[&str], timeout: Duration) -> Result<Value, ()> {
    let mut child = Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|_| ())?;

    // stdout은 별도 스레드로 끝까지 읽는다 — 파이프 버퍼(수십 KB)가 차면 자식이 write에서 멈춰
    // 타임아웃 오탐(건강한 자식 kill)이 난다. 세션 JSON은 수 MB일 수 있다(v1 maxBuffer 64MB).
    let mut stdout = child.stdout.take().ok_or(())?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        stdout.read_to_end(&mut buf).map(|_| buf).map_err(|_| ())
    });

    let status = match child.wait_timeout(timeout).map_err(|_| ())? {
        Some(status) => status,
        None => {
            let _ = child.kill(); // 타임아웃 — v1과 동일하게 강제 종료 후 실패 처리
            let _ = child.wait();
            // 리더는 join하지 않고 버린다(detach): cmd 등 중간 프로세스가 손자를 띄웠으면 손자가
            // 파이프 쓰기측 핸들을 상속해 kill 후에도 파이프가 안 닫힐 수 있다 — join하면 손자
            // 종료까지 블록된다(테스트로 실증). v1 execFile timeout도 즉시 반환하고 배수는
            // 백그라운드였다. 스레드는 파이프가 닫히는 순간 스스로 끝난다.
            drop(reader);
            return Err(());
        }
    };
    let bytes = reader.join().map_err(|_| ())??;
    if !status.success() {
        return Err(());
    }
    serde_json::from_slice(&bytes).map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    // 실 ccusage 대신 temp 배치 파일을 스폰한다(로컬 프로세스 — 네트워크 없음).
    // Rust std는 .bat/.cmd를 cmd.exe /c로 감싸 실행한다(인자 이스케이프 포함).
    fn bat(dir: &Path, name: &str, body: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, body).unwrap();
        p
    }

    #[test]
    fn parses_json_stdout() {
        let tmp = tempfile::tempdir().unwrap();
        let p = bat(tmp.path(), "ok.bat", "@echo {\"daily\":[]}\r\n");
        let v = run_ccusage(&p, &[]).unwrap();
        assert!(v["daily"].as_array().unwrap().is_empty());
    }

    #[test]
    fn non_json_output_is_err() {
        let tmp = tempfile::tempdir().unwrap();
        let p = bat(tmp.path(), "bad.bat", "@echo definitely-not-json\r\n");
        assert!(run_ccusage(&p, &[]).is_err());
    }

    #[test]
    fn nonzero_exit_is_err_even_with_json_output() {
        let tmp = tempfile::tempdir().unwrap();
        let p = bat(tmp.path(), "fail.bat", "@echo {\"daily\":[]}\r\n@exit /b 3\r\n");
        assert!(run_ccusage(&p, &[]).is_err());
    }

    #[test]
    fn missing_binary_is_err() {
        assert!(run_ccusage(Path::new("Z:\\no\\such\\ccusage.exe"), &[]).is_err());
    }

    #[test]
    fn timeout_kills_and_errs() {
        let tmp = tempfile::tempdir().unwrap();
        // ping 루프백으로 ~9초 지연 — 300ms 타임아웃이 먼저 발동해야 한다
        let p = bat(tmp.path(), "slow.bat", "@ping -n 10 127.0.0.1 > nul\r\n@echo {}\r\n");
        let started = Instant::now();
        assert!(run_ccusage_with_timeout(&p, &[], Duration::from_millis(300)).is_err());
        assert!(started.elapsed() < Duration::from_secs(5), "타임아웃이 발동하지 않았다");
    }

    #[test]
    fn bin_path_is_next_to_current_exe() {
        let p = ccusage_bin_path().unwrap();
        assert!(p.ends_with("ccusage.exe"));
        assert_eq!(p.parent(), std::env::current_exe().unwrap().parent());
    }
}
