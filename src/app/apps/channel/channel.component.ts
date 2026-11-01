import {Component, Host, Input, OnInit, ChangeDetectionStrategy, effect, untracked} from '@angular/core';
import {catchError, Observable, of} from 'rxjs';
import {AppsRepoService, RepositoryPage} from '../../core/services';
import {AppsComponent} from '../apps.component';
import {RawPackageInfo} from "../../types";
import {RepositorySourcesService} from '../../core/services/repository-sources.service';

@Component({
    selector: 'app-channel',
    templateUrl: './channel.component.html',
    styleUrls: ['./channel.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class ChannelComponent implements OnInit {

  page = 1;
  repoPage$?: Observable<RepositoryPage | null>;
  repoError?: Error;
  private loadGeneration = 0;

  @Input()
  installed?: Record<string, RawPackageInfo>;

  constructor(
    @Host() public parent: AppsComponent,
    private appsRepo: AppsRepoService,
    public sources: RepositorySourcesService) {
    let selected = sources.selectedId();
    effect(() => {
      const next = sources.selectedId();
      if (next !== selected) {
        selected = next;
        untracked(() => this.loadPage(1));
      }
    });
  }

  ngOnInit(): void {
    this.loadPage(1);
  }

  loadPage(page: number): void {
    const generation = ++this.loadGeneration;
    this.page = page;
    this.repoError = undefined;
    const source = this.sources.selected();
    const request = source.builtIn ? this.appsRepo.allApps$(page) : this.appsRepo.allApps$(page, source.url);
    this.repoPage$ = request.pipe(catchError(error => {
      if (generation === this.loadGeneration) {
        this.repoError = error instanceof Error ? error : new Error(String(error));
      }
      return of(null);
    }));
  }
}
